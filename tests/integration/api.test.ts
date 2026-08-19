// FICTIONAL-CNIC-OK: fictional CNICs; asserts the PII tripwire fires and does not echo. Never real customer data.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createGateway } from '../../services/gateway/src/http.ts';
import { harness, a2Attributes, CNIC_WALLET, CNIC_FRESH, CNIC_EXPIRY_OK } from '../fixture.ts';

let server: Server;
let base: string;
let h: ReturnType<typeof harness>;

const BANK = { 'x-abhi-msp': 'ABHIBankMSP', 'x-abhi-role': 'gateway' };
const LENDING = { 'x-abhi-msp': 'ABHILendingMSP', 'x-abhi-role': 'gateway' };
const COMPLIANCE = { 'x-abhi-msp': 'ABHIComplianceMSP', 'x-abhi-role': 'compliance-officer' };

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = BANK,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json() };
}

before(async () => {
  h = harness();
  server = createGateway({ service: h.svc, logRequests: false });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('gateway HTTP API', () => {
  test('GET /health', async () => {
    const r = await call('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'ok');
    assert.equal(r.json.ledger, 'simulated');
  });

  test('POST /kyc/register creates v1', async () => {
    const r = await call('POST', '/kyc/register', {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.version, 1);
    assert.equal(r.json.assuranceLevel, 'A2');
  });

  test('POST /kyc/verify returns ALLOW for EWA', async () => {
    const r = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'EWA' }, LENDING);
    assert.equal(r.status, 200);
    assert.equal(r.json.decision.outcome, 'ALLOW');
    assert.equal(r.json.railCallsAvoided, 3);
  });

  test('POST /kyc/verify returns STEP_UP for SBL naming liveness', async () => {
    const r = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'SBL' }, LENDING);
    assert.equal(r.json.decision.outcome, 'STEP_UP');
    assert.deepEqual(r.json.decision.missingMethods, ['LIVENESS']);
  });

  test('POST /consent/create then verify returns a proof', async () => {
    const c = await call('POST', '/consent/create', {
      cnic: CNIC_WALLET,
      grantedTo: 'ABHILendingMSP',
      purpose: 'EWA_ORIGINATION',
      scope: ['verisys_match', 'cnic_expiry'],
      expiresAt: '2027-01-01T00:00:00Z',
      evidenceRef: 'tc-api-001',
    });
    assert.equal(c.status, 201);

    const v = await call(
      'POST',
      '/kyc/verify',
      { cnic: CNIC_WALLET, productId: 'EWA', consentId: c.json.consentId },
      LENDING,
    );
    assert.equal(v.json.proof.attributes.length, 2);
  });

  test('GET /kyc/history returns a valid chain', async () => {
    const r = await call('GET', `/kyc/history?cnic=${encodeURIComponent(CNIC_WALLET)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.chainValid, true);
    assert.ok(r.json.versionCount >= 1);
  });

  test('GET /audit/events returns the audit trail', async () => {
    const r = await call('GET', `/audit/events?cnic=${encodeURIComponent(CNIC_WALLET)}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.events));
    assert.ok(r.json.events.some((e: any) => e.action === 'REGISTER'));
  });

  test('POST /kyc/suspend from a product org is 403', async () => {
    const r = await call(
      'POST',
      '/kyc/suspend',
      { cnic: CNIC_WALLET, reason: 'attempt', referenceId: 'X' },
      LENDING,
    );
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'ERR_INSUFFICIENT_ROLE');
  });

  test('POST /kyc/suspend from Compliance succeeds and propagates', async () => {
    const s = await call(
      'POST',
      '/kyc/suspend',
      { cnic: CNIC_WALLET, reason: 'AML review', referenceId: 'CASE-1' },
      COMPLIANCE,
    );
    assert.equal(s.status, 200);

    const v = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'EWA' }, LENDING);
    assert.equal(v.json.decision.outcome, 'DENY');
    assert.equal(v.json.decision.reason, 'SUSPENDED');

    await call(
      'POST',
      '/kyc/reinstate',
      { cnic: CNIC_WALLET, reason: 'cleared', referenceId: 'CASE-1' },
      COMPLIANCE,
    );
  });

  test('unknown subject on history is 404', async () => {
    const r = await call('GET', `/kyc/history?cnic=${encodeURIComponent(CNIC_FRESH)}`);
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'ERR_SUBJECT_NOT_FOUND');
  });

  test('POST /employer/bulk-lookup splits an upload', async () => {
    const r = await call('POST', '/employer/bulk-lookup', {
      cnics: ['6110112345678', CNIC_FRESH, 'garbage'],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.activateNow, ['6110112345678']);
    assert.deepEqual(r.json.invalid, ['garbage']);
  });

  test('every response carries a correlation id and security headers', async () => {
    const res = await fetch(`${base}/health`);
    assert.ok(res.headers.get('x-correlation-id'));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('a PII-bearing payload is rejected without echoing the value', async () => {
    const r = await call('POST', '/kyc/register', {
      cnic: CNIC_FRESH,
      attributes: a2Attributes(),
      originProduct: 'WALLET-6110112345678',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'ERR_PII_DETECTED');
    // Security-class errors must not echo detail back to the caller.
    assert.equal(r.json.detail, undefined);
    assert.equal(JSON.stringify(r.json).includes('6110112345678'), false);
  });

  test('unknown route is 404', async () => {
    const r = await call('GET', '/nope');
    assert.equal(r.status, 404);
  });

  test('GET /metrics exposes cost instrumentation', async () => {
    const r = await call('GET', '/metrics');
    assert.equal(r.status, 200);
    assert.ok(typeof r.json.rails.callsAvoided === 'number');
    assert.ok(typeof r.json.rails.costAvoidedPkr === 'number');
    assert.ok(typeof r.json.ecibCalls === 'number');
  });
});
