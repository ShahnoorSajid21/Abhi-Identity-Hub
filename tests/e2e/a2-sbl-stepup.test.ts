// FICTIONAL-CNIC-OK: fictional CNIC for the A2-to-SBL step-up scenario. Never real customer data.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createGateway } from '../../services/gateway/src/http.ts';
import {
  harness,
  a2Attributes,
  CNIC_WALLET,
  CNIC_EXPIRY_OK,
  NOW,
  type Harness,
} from '../fixture.ts';

/**
 * PHASE-5 · An A2 customer applies for a Salary-Backed Loan.
 *
 * The single scenario the whole programme is built to make possible. Today
 * this customer repeats the entire onboarding pack — NADRA match, CNIC
 * document check, fingerprint — to borrow against a salary ABHI already
 * disburses. The correct answer is one selfie.
 *
 * This is the backend half, driven over real HTTP. The frontend half — that
 * the UI transitions straight to face verification and never mounts the
 * fingerprint scanner — is in apps/web/src/apply/A2SblStepUp.e2e.test.tsx and
 * consumes the exact response shape asserted here.
 *
 * The split is deliberate. One mixed test would have to either mock the
 * gateway, proving nothing about the decision, or boot jsdom inside the
 * backend suite, proving nothing about the browser. Each half runs in the
 * runner that can actually exercise its side, against a shared contract.
 */

const LENDING = { 'x-abhi-msp': 'ABHILendingMSP', 'x-abhi-role': 'gateway' };
const BANK = { 'x-abhi-msp': 'ABHIBankMSP', 'x-abhi-role': 'gateway' };

let server: Server;
let base: string;
let h: Harness;

interface VerifyBody {
  subjectId: string;
  decision: {
    outcome: string;
    reason: string;
    missingMethods: string[];
    disclosableAttributes: string[];
    currentAssurance: string | null;
    requiredAssurance: string;
  };
  proof: unknown;
  eCibCalled: boolean;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = LENDING,
): Promise<{ status: number; json: any; raw: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  return { status: res.status, json: raw.length > 0 ? JSON.parse(raw) : null, raw };
}

before(async () => {
  h = harness();
  server = createGateway({ service: h.svc, logRequests: false });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;

  // The customer as wallet onboarding leaves them: A2, three paid rails, no
  // liveness ever run. Asserted rather than assumed — if this precondition
  // drifts, every assertion below becomes meaningless rather than red.
  const reg = await call(
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
  assert.equal(reg.status, 201);
  assert.equal(reg.json.assuranceLevel, 'A2');
  assert.deepEqual(reg.json.methods, ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS']);
  assert.equal(reg.json.railCallsMade, 3);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
describe('PHASE-5 · A2 customer applying for SBL', () => {
  test('the backend returns STEP_UP requesting liveness, and nothing else', async () => {
    const r = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'SBL' });
    assert.equal(r.status, 200);

    const b = r.json as VerifyBody;
    assert.equal(b.decision.outcome, 'STEP_UP');
    assert.equal(b.decision.reason, 'ASSURANCE_LOW');
    assert.equal(b.decision.currentAssurance, 'A2');
    assert.equal(b.decision.requiredAssurance, 'A3');

    // The assertion the business case rests on. Not "fewer checks" — exactly
    // one, and specifically the one this customer has never done.
    assert.deepEqual(b.decision.missingMethods, ['LIVENESS']);
    assert.equal(
      b.decision.missingMethods.includes('BIOMETRIC_1TO1'),
      false,
      'the fingerprint already on the ledger must not be requested again',
    );
    assert.equal(b.decision.missingMethods.includes('VERISYS'), false);
    assert.equal(b.decision.missingMethods.includes('DOC_AUTH'), false);

    // A STEP_UP discloses nothing: the product is not yet entitled to the
    // record it is asking about.
    assert.equal(b.proof, null);
    assert.deepEqual(b.decision.disclosableAttributes, []);
  });

  test('the same answer comes back keyed by subject id, with no CNIC in flight', async () => {
    const subjectId = await h.svc.subjectId(CNIC_WALLET);

    // This is the exact request apps/web issues from /apply/SBL. The customer
    // journey holds a subject id; a CNIC in a request body that did not need
    // one is PII travelling for no reason.
    const r = await call('POST', '/kyc/verify', { subjectId, productId: 'SBL' });
    assert.equal(r.status, 200);

    const b = r.json as VerifyBody;
    assert.equal(b.subjectId, subjectId);
    assert.equal(b.decision.outcome, 'STEP_UP');
    assert.deepEqual(b.decision.missingMethods, ['LIVENESS']);
    assert.equal(b.decision.requiredAssurance, 'A3');

    // The CNIC appears nowhere in what the browser receives, in either form.
    assert.equal(r.raw.includes('6110112345678'), false);
    assert.equal(r.raw.includes('61101-1234567-8'), false);
  });

  test('a malformed subject id is refused rather than treated as unknown', async () => {
    // Returning FULL_KYC for a garbage identifier would let a caller probe the
    // API without ever holding a valid subject.
    const r = await call('POST', '/kyc/verify', { subjectId: 'not-a-subject', productId: 'SBL' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'ERR_INVALID_SUBJECT');
  });

  test('the credit check still runs — reuse never displaces e-CIB', async () => {
    const before = h.ecib.calls;
    const r = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'SBL' });

    assert.equal((r.json as VerifyBody).eCibCalled, true);
    assert.equal(h.ecib.calls, before + 1, 'a STEP_UP is still an origination');
  });

  test('the same A2 record is ALLOWED for EWA — the record did not change, the bar did', async () => {
    const ewa = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'EWA' });
    assert.equal((ewa.json as VerifyBody).decision.outcome, 'ALLOW');

    const sbl = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'SBL' });
    assert.equal((sbl.json as VerifyBody).decision.outcome, 'STEP_UP');
  });

  test('running only the selfie reaches A3 on one paid rail, and the loan proceeds', async () => {
    const railsBefore = h.rails.metrics.callsMade;

    // The step-up supplies ONLY liveness. Everything already confirmed is
    // carried forward from the existing record rather than re-run.
    const up = await call('POST', '/kyc/update', {
      cnic: CNIC_WALLET,
      productId: 'SBL',
      attributes: { ...a2Attributes(), liveness_pass: true },
      cnicExpiryAt: CNIC_EXPIRY_OK,
      reason: 'Step-up to A3 for SBL',
    });

    assert.equal(up.status, 200);
    assert.equal(up.json.assuranceLevel, 'A3');
    assert.equal(up.json.version, 2, 'a step-up appends a version, never edits v1');

    // One paid rail, not four. This is the money.
    assert.equal(
      h.rails.metrics.callsMade - railsBefore,
      1,
      'exactly one rail call: the liveness check',
    );

    const after = await call('POST', '/kyc/verify', { cnic: CNIC_WALLET, productId: 'SBL' });
    const b = after.json as VerifyBody;
    assert.equal(b.decision.outcome, 'ALLOW');
    assert.deepEqual(b.decision.missingMethods, []);
    assert.equal(b.decision.currentAssurance, 'A3');
  });

  test('liveness is capped at three attempts a day, enforced by the gateway', async () => {
    // The browser's counter is a courtesy; this is the control. A customer
    // who clears their browser storage still cannot exceed the cap.
    const h2 = harness();
    const subjectId = await h2.svc.subjectId(CNIC_WALLET);

    for (let i = 0; i < 3; i++) {
      await h2.rails.call(subjectId, 'LIVENESS', NOW);
    }
    await assert.rejects(
      () => h2.rails.call(subjectId, 'LIVENESS', NOW),
      /ERR_ATTEMPT_CAP_EXCEEDED/,
    );
    assert.equal(h2.rails.metrics.capLockouts, 1);
  });
});
