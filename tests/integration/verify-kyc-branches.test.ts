// FICTIONAL-CNIC-OK: fictional CNICs exercising every VerifyKYC branch. Never real customer data.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import type { DecisionOutcome } from '@abhi/types';
import { PRODUCT_POLICIES } from '@abhi/policy';
import {
  harness,
  a0Attributes,
  a2Attributes,
  a3Attributes,
  CNIC_WALLET,
  CNIC_FRESH,
  CNIC_EXPIRY_OK,
  CNIC_EXPIRY_PAST,
  NOW,
  type Harness,
} from '../fixture.ts';

/**
 * VerifyKYC — every branch of the state machine, exercised through the
 * gateway rather than against the pure engine.
 *
 * `packages/policy/test/engine.test.ts` already covers the decision table
 * exhaustively, but it covers `decide()` in isolation: a pure function over a
 * record it is handed. This suite covers the branch a PRODUCT actually
 * traverses — ledger read, policy load, decision, e-CIB, proof assembly — and
 * asserts the side effects the pure engine cannot have, above all that the
 * credit check fires.
 *
 * The two are complementary and both are needed. A regression that wired
 * `decide()` up to the wrong policy, or skipped e-CIB on the reuse path, would
 * leave the engine suite entirely green.
 */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY);

/** Register a subject at the given assurance, then read the decision back. */
async function verifyFor(
  h: Harness,
  cnic: string,
  productId: string,
  opts: { at?: Date } = {},
) {
  return h.svc.verify(h.lending({ timestamp: opts.at ?? NOW }), cnic, productId, null);
}

// ===========================================================================
describe('PHASE-3 · VerifyKYC state machine — every branch', () => {
  test('record missing -> FULL_KYC, naming the full method pack', async () => {
    const h = harness();
    const v = await verifyFor(h, CNIC_FRESH, 'EWA');

    assert.equal(v.decision.outcome, 'FULL_KYC');
    assert.equal(v.decision.reason, 'NO_RECORD');
    assert.equal(v.decision.currentAssurance, null);
    assert.equal(v.decision.requiredAssurance, 'A2');
    // A customer with nothing on file runs the whole A2 pack, not a step-up.
    assert.deepEqual(v.decision.missingMethods, ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']);
    assert.equal(v.proof, null);
  });

  test('status SUSPENDED -> DENY, and it outranks every other consideration', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    await h.svc.suspend(h.compliance(), CNIC_WALLET, 'AML alert', 'CASE-2026-114');

    // A3 against an A3 product, in date, freshly verified — every other rule
    // says ALLOW. The compliance freeze wins anyway.
    const v = await verifyFor(h, CNIC_WALLET, 'SBL');
    assert.equal(v.decision.outcome, 'DENY');
    assert.equal(v.decision.reason, 'SUSPENDED');
    assert.equal(v.proof, null);
  });

  test('CNIC expired -> DENY as a hard stop, never STEP_UP', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_PAST,
    });

    const v = await verifyFor(h, CNIC_WALLET, 'SBL');
    assert.equal(v.decision.outcome, 'DENY');
    assert.equal(v.decision.reason, 'CNIC_EXPIRED');
    // No method can be offered: re-scanning an expired card produces an
    // expired card. Only NADRA renewal clears this.
    assert.deepEqual(v.decision.missingMethods, []);
    assert.equal(v.proof, null);
  });

  test('CNIC expiry outranks a low assurance level', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_PAST,
    });
    // A2 against SBL would otherwise be STEP_UP. Expiry is checked first, so
    // the customer is not sent to run a selfie they cannot benefit from.
    const v = await verifyFor(h, CNIC_WALLET, 'SBL');
    assert.equal(v.decision.outcome, 'DENY');
    assert.equal(v.decision.reason, 'CNIC_EXPIRED');
  });

  test('assurance insufficient -> STEP_UP naming ONLY the missing methods', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    // A2 -> A3 for SBL. One selfie, not a re-onboarding. This single assertion
    // is the commercial claim of the entire programme.
    const sbl = await verifyFor(h, CNIC_WALLET, 'SBL');
    assert.equal(sbl.decision.outcome, 'STEP_UP');
    assert.equal(sbl.decision.reason, 'ASSURANCE_LOW');
    assert.equal(sbl.decision.currentAssurance, 'A2');
    assert.equal(sbl.decision.requiredAssurance, 'A3');
    assert.deepEqual(sbl.decision.missingMethods, ['LIVENESS']);
    assert.ok(!sbl.decision.missingMethods.includes('BIOMETRIC_1TO1'), 'fingerprint is reused, not repeated');
    assert.equal(sbl.proof, null);

    // Merchant Financing is the other A3 product and must behave identically.
    const mf = await verifyFor(h, CNIC_WALLET, 'MERCHANT_FINANCING');
    assert.equal(mf.decision.outcome, 'STEP_UP');
    assert.deepEqual(mf.decision.missingMethods, ['LIVENESS']);
  });

  test('an A0 employer-asserted record steps up to the full A2 pack', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a0Attributes(),
      originProduct: 'EMPLOYER_BULK',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const v = await verifyFor(h, CNIC_WALLET, 'EWA');
    assert.equal(v.decision.outcome, 'STEP_UP');
    assert.equal(v.decision.currentAssurance, 'A0');
    assert.deepEqual(v.decision.missingMethods, ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']);
  });

  test('past maxAgeDays -> STEP_UP re-affirming the strongest method only', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: iso(at(4000)),
    });

    // SBL allows 180 days. At 200 the record is stale but not deficient.
    const v = await verifyFor(h, CNIC_WALLET, 'SBL', { at: at(200) });
    assert.equal(v.decision.outcome, 'STEP_UP');
    assert.equal(v.decision.reason, 'STALE');
    assert.equal(v.decision.ageDays, 200);
    assert.deepEqual(v.decision.missingMethods, ['LIVENESS'], 'strongest method only');

    // EWA allows 365, so the same record is still fresh enough there — the
    // staleness bound is per product, not global.
    const ewa = await verifyFor(h, CNIC_WALLET, 'EWA', { at: at(200) });
    assert.equal(ewa.decision.outcome, 'ALLOW');
  });

  test('assurance is evaluated before staleness', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: iso(at(4000)),
    });
    // Both stale AND under-assured for SBL. Satisfying the assurance gap also
    // refreshes the clock, so reporting ASSURANCE_LOW is the actionable answer.
    const v = await verifyFor(h, CNIC_WALLET, 'SBL', { at: at(300) });
    assert.equal(v.decision.reason, 'ASSURANCE_LOW');
    assert.deepEqual(v.decision.missingMethods, ['LIVENESS']);
  });

  test('all checks pass -> ALLOW, disclosing only the product’s entitled attributes', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const v = await verifyFor(h, CNIC_WALLET, 'EWA');
    assert.equal(v.decision.outcome, 'ALLOW');
    assert.equal(v.decision.reason, 'SUFFICIENT');
    assert.deepEqual(
      [...v.decision.disclosableAttributes].sort(),
      [...PRODUCT_POLICIES['EWA']!.disclosableAttributes].sort(),
    );
    // EWA is not entitled to date_of_birth even though the record commits to
    // it — entitlement is per policy, not per record.
    assert.ok(!v.decision.disclosableAttributes.includes('date_of_birth'));
    assert.ok(v.railCallsAvoided > 0, 'an ALLOW must record the rail calls it avoided');
  });

  test('ALLOW with a consent yields verifiable Merkle proofs, and nothing wider', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    const consent = await h.svc.grantConsent(
      h.bank(),
      CNIC_WALLET,
      'ABHILendingMSP',
      'SBL origination',
      ['verisys_match', 'biometric_match', 'liveness_pass'],
      iso(at(30)),
      'CONSENT-EVID-1',
    );

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'SBL', consent.consentId, [
      'verisys_match',
      'liveness_pass',
      // Requested but outside consent — must be silently narrowed away, not
      // returned and not an error.
      'date_of_birth',
    ]);

    assert.equal(v.decision.outcome, 'ALLOW');
    assert.notEqual(v.proof, null);
    const names = v.proof!.attributes.map((a) => a.name).sort();
    assert.deepEqual(names, ['liveness_pass', 'verisys_match']);
    assert.match(v.proof!.merkleRoot, /^[0-9a-f]{64}$/);
  });

  test('SHREDDED -> FULL_KYC, not DENY — the customer is not barred', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    await h.svc.shred(h.compliance(), CNIC_WALLET, 'erasure request', 'PDPB Art.X');

    const v = await verifyFor(h, CNIC_WALLET, 'EWA');
    assert.equal(v.decision.outcome, 'FULL_KYC');
    assert.equal(v.decision.reason, 'SHREDDED');
  });

  test('an unknown product is refused rather than defaulted', async () => {
    const h = harness();
    await assert.rejects(
      () => verifyFor(h, CNIC_WALLET, 'NOT_A_PRODUCT'),
      /ERR_INVALID_SCOPE/,
      'defaulting an unknown product to a permissive policy would be a silent bypass',
    );
  });

  test('the decision is deterministic — the same request always answers the same', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const runs = await Promise.all([1, 2, 3].map(() => verifyFor(h, CNIC_WALLET, 'SBL')));
    for (const r of runs) {
      assert.equal(r.decision.outcome, runs[0]!.decision.outcome);
      assert.deepEqual(r.decision.missingMethods, runs[0]!.decision.missingMethods);
      assert.equal(r.decision.policyId, runs[0]!.decision.policyId);
    }
  });
});

// ===========================================================================
describe('PHASE-3 · e-CIB is never displaced by identity reuse', () => {
  /**
   * The single most dangerous misreading of this design would be that a reused
   * KYC record also reuses the credit check. It does not. e-CIB is a CREDIT
   * enquiry answering "what does this person already owe?" — an answer that
   * changes weekly and has nothing to do with how strongly their identity was
   * proven. An A3 customer verified this morning still gets a fresh e-CIB.
   */

  test('e-CIB runs on ALLOW — the reuse path is not a bypass', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    assert.equal(h.ecib.calls, 0, 'registration is not an origination');

    const v = await verifyFor(h, CNIC_WALLET, 'SBL');
    assert.equal(v.decision.outcome, 'ALLOW');
    assert.equal(v.eCibCalled, true);
    assert.equal(h.ecib.calls, 1);
  });

  test('e-CIB runs at every assurance level that reaches origination', async () => {
    // A0 through A3, all against SBL. The identity answer differs each time;
    // the credit enquiry does not.
    const cases: { attrs: Record<string, string | boolean | number>; expect: DecisionOutcome }[] = [
      { attrs: a0Attributes(), expect: 'STEP_UP' },
      { attrs: a2Attributes(), expect: 'STEP_UP' },
      { attrs: a3Attributes(), expect: 'ALLOW' },
    ];

    for (const c of cases) {
      const h = harness();
      await h.svc.register(h.bank(), {
        cnic: CNIC_WALLET,
        attributes: c.attrs,
        originProduct: 'WALLET',
        cnicExpiryAt: CNIC_EXPIRY_OK,
      });
      const v = await verifyFor(h, CNIC_WALLET, 'SBL');
      assert.equal(v.decision.outcome, c.expect);
      assert.equal(v.eCibCalled, true, `e-CIB skipped at ${v.decision.currentAssurance}`);
      assert.equal(h.ecib.calls, 1);
    }
  });

  test('e-CIB runs on FULL_KYC — a brand-new customer is still credit-checked', async () => {
    const h = harness();
    const v = await verifyFor(h, CNIC_FRESH, 'EWA');
    assert.equal(v.decision.outcome, 'FULL_KYC');
    assert.equal(v.eCibCalled, true);
    assert.equal(h.ecib.calls, 1);
  });

  test('e-CIB runs once per verification, and repeat verifications each get one', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    await verifyFor(h, CNIC_WALLET, 'EWA');
    await verifyFor(h, CNIC_WALLET, 'ASA');
    await verifyFor(h, CNIC_WALLET, 'SBL');

    // Three originations, three credit enquiries. Identity was reused all
    // three times; credit was not.
    assert.equal(h.ecib.calls, 3);
    assert.equal(h.rails.metrics.callsMade, 4, 'no identity rail was re-run');
  });

  test('e-CIB is skipped ONLY on DENY, where no origination proceeds', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_PAST,
    });

    // Documented deliberately: a DENY means the application stops, so a paid
    // credit enquiry would buy nothing. This is the ONE case, and it is a
    // compliance/document stop — never an assurance-level shortcut.
    const v = await verifyFor(h, CNIC_WALLET, 'SBL');
    assert.equal(v.decision.outcome, 'DENY');
    assert.equal(v.eCibCalled, false);
    assert.equal(h.ecib.calls, 0);
  });
});
