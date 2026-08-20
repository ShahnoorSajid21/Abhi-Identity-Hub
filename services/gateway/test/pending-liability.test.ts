// FICTIONAL-CNIC-OK: fictional CNICs driving the dashboard summary. Never real customer data.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createGateway } from '../src/http.ts';
import { DEFAULT_RAIL_COSTS } from '../src/rails.ts';
import {
  harness,
  a0Attributes,
  a2Attributes,
  CNIC_WALLET,
  CNIC_FRESH,
  CNIC_EMPLOYER,
  CNIC_EXPIRY_OK,
  type Harness,
} from '../../../tests/fixture.ts';

/**
 * The queued-cost figure on the dashboard.
 *
 * This exists because the dashboard previously read "PKR 600 avoided, PKR 0
 * spent", which is arithmetically true and reads as an infinite return. Spend
 * is booked only when a rail actually runs, and a verification decides without
 * buying anything — so an outstanding queue of step-ups looked free right up
 * until somebody actioned it.
 *
 * A money figure on a dashboard is read as fact by people who will not read
 * the code, so the arithmetic is pinned here rather than trusted.
 */

const BANK = { 'x-abhi-msp': 'ABHIBankMSP', 'x-abhi-role': 'gateway' };
const LENDING = { 'x-abhi-msp': 'ABHILendingMSP', 'x-abhi-role': 'gateway' };

let server: Server;
let base: string;
let h: Harness;

interface Summary {
  pendingChecks: number;
  pendingCostPkr: number;
  pendingRequests: number;
  queueCounts: Record<string, number>;
  spendAvoidedTodayPkr: number;
}

async function call(method: string, path: string, body?: unknown, headers = BANK) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const summary = async (): Promise<Summary> => (await call('GET', '/dashboard/summary')).json;

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

// ===========================================================================
describe('dashboard · queued verification cost', () => {
  test('an empty queue owes nothing', async () => {
    const s = await summary();
    assert.equal(s.pendingRequests, 0);
    assert.equal(s.pendingChecks, 0);
    assert.equal(s.pendingCostPkr, 0);
  });

  test('an ALLOW adds nothing — there is nothing left to run', async () => {
    await call(
      'POST',
      '/kyc/register',
      {
        cnic: CNIC_WALLET,
        attributes: a2Attributes(),
        originProduct: 'WALLET',
        cnicExpiryAt: CNIC_EXPIRY_OK,
      },
      BANK,
    );
    // A2 satisfies EWA outright, and is one selfie short of SBL — the pair
    // this whole feature exists to price.
    const v = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'EWA' }, LENDING);
    assert.equal(v.json.decision.outcome, 'ALLOW');

    const s = await summary();
    assert.equal(s.pendingRequests, 0, 'a reused identity owes no future spend');
    assert.equal(s.pendingCostPkr, 0);
    assert.ok(s.spendAvoidedTodayPkr > 0, 'but it does record what it avoided');
  });

  test('a STEP_UP owes exactly the cost of the methods it is missing', async () => {
    // A2 against SBL needs LIVENESS and nothing else.
    const before = await summary();
    const v = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'SBL' }, LENDING);
    assert.equal(v.json.decision.outcome, 'STEP_UP');
    assert.deepEqual(v.json.decision.missingMethods, ['LIVENESS']);

    const after = await summary();
    assert.equal(after.pendingRequests, before.pendingRequests + 1);
    assert.equal(after.pendingChecks, before.pendingChecks + 1);
    assert.equal(
      after.pendingCostPkr - before.pendingCostPkr,
      DEFAULT_RAIL_COSTS.LIVENESS.unitCostPkr,
      'one selfie, at the liveness unit cost',
    );
  });

  test('a FULL_KYC owes the whole pack the product requires', async () => {
    const before = await summary();
    // Nobody on file: EWA needs A2 — Verisys, doc auth and a fingerprint.
    const v = await call('POST', '/kyc/verify', { cnic: CNIC_FRESH, productId: 'EWA' }, LENDING);
    assert.equal(v.json.decision.outcome, 'FULL_KYC');

    const expected =
      DEFAULT_RAIL_COSTS.VERISYS.unitCostPkr +
      DEFAULT_RAIL_COSTS.DOC_AUTH.unitCostPkr +
      DEFAULT_RAIL_COSTS.BIOMETRIC_1TO1.unitCostPkr;

    const after = await summary();
    assert.equal(after.pendingChecks, before.pendingChecks + 3);
    assert.equal(after.pendingCostPkr - before.pendingCostPkr, expected);
  });

  test('the total is the sum of every outstanding request, priced per method', async () => {
    const s = await summary();

    // Recompute independently from the queue the console renders.
    const queue = (await call('GET', '/queue?decision=STEP_UP')).json.rows as {
      missingMethods: (keyof typeof DEFAULT_RAIL_COSTS)[];
    }[];
    const full = (await call('GET', '/queue?decision=FULL_KYC')).json.rows as {
      missingMethods: (keyof typeof DEFAULT_RAIL_COSTS)[];
    }[];

    let checks = 0;
    let cost = 0;
    for (const r of [...queue, ...full]) {
      for (const m of r.missingMethods) {
        checks += 1;
        cost += DEFAULT_RAIL_COSTS[m].unitCostPkr;
      }
    }

    assert.equal(s.pendingChecks, checks);
    assert.equal(s.pendingCostPkr, cost);
    assert.equal(s.pendingRequests, queue.length + full.length);
  });

  test('a DENY owes nothing — the application stops', async () => {
    // An employer-asserted A0 record, then frozen by Compliance.
    await call(
      'POST',
      '/kyc/register',
      {
        cnic: CNIC_EMPLOYER,
        attributes: a0Attributes(),
        originProduct: 'EMPLOYER_BULK',
        cnicExpiryAt: CNIC_EXPIRY_OK,
      },
      BANK,
    );
    await call(
      'POST',
      '/kyc/suspend',
      { cnic: CNIC_EMPLOYER, reason: 'AML alert', referenceId: 'CASE-1' },
      { 'x-abhi-msp': 'ABHIComplianceMSP', 'x-abhi-role': 'compliance-officer' },
    );

    const before = await summary();
    const v = await call(
      'POST',
      '/kyc/verify',
      { cnic: CNIC_EMPLOYER, productId: 'EWA' },
      LENDING,
    );
    assert.equal(v.json.decision.outcome, 'DENY');

    const after = await summary();
    assert.equal(after.pendingCostPkr, before.pendingCostPkr, 'a denied application buys nothing');
    assert.equal(after.pendingRequests, before.pendingRequests);
  });

  test('the figure is priced from the same table the rails bill against', async () => {
    // If these ever diverge, the dashboard is quoting a price the system does
    // not charge — which is worse than quoting nothing.
    assert.equal(DEFAULT_RAIL_COSTS.VERISYS.unitCostPkr, 25);
    assert.equal(DEFAULT_RAIL_COSTS.DOC_AUTH.unitCostPkr, 15);
    assert.equal(DEFAULT_RAIL_COSTS.BIOMETRIC_1TO1.unitCostPkr, 40);
    assert.equal(DEFAULT_RAIL_COSTS.LIVENESS.unitCostPkr, 20);
    assert.equal(DEFAULT_RAIL_COSTS.ASSERTED.unitCostPkr, 0);
  });
});
