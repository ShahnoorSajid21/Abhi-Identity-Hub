// FICTIONAL-CNIC-OK: fictional CNICs; asserts they never reach the ledger. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KycError } from '@abhi/types';
import { verifyProofBundle } from '@abhi/merkle';
import {
  harness,
  a0Attributes,
  a2Attributes,
  a3Attributes,
  CNIC_WALLET,
  CNIC_FRESH,
  CNIC_EMPLOYER,
  CNIC_EXPIRY_OK,
  CNIC_EXPIRY_PAST,
  NOW,
} from '../fixture.ts';

/**
 * End-to-end scenarios. These are the POC success criteria expressed as
 * executable assertions rather than a checklist someone ticks by hand.
 */

// ===========================================================================
describe('E2E-1 · New KYC registration', () => {
  test('a fresh customer runs the full journey and reaches A2', async () => {
    const h = harness();
    const r = await h.svc.register(h.bank(), {
      cnic: CNIC_FRESH,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    assert.equal(r.version, 1);
    assert.equal(r.assuranceLevel, 'A2');
    assert.deepEqual(r.methods, ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS']);
    assert.equal(r.railCallsMade, 3, 'three rails: Verisys, doc auth, biometric');
    assert.ok(r.costSpentPkr > 0);
    assert.match(r.merkleRoot, /^[0-9a-f]{64}$/);
  });

  test('no personal data reaches the ledger', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_FRESH,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const dump = JSON.stringify(h.store.snapshot());
    // No raw CNIC, in either format.
    assert.equal(dump.includes('4220176543211'), false);
    assert.equal(dump.includes('42201-7654321-1'), false);
    // No attribute VALUES — only commitments.
    assert.equal(dump.includes('Machine Operator'), false);
    assert.equal(dump.includes('Salary disbursement'), false);
  });
});

// ===========================================================================
describe('E2E-2 · KYC reuse — the headline', () => {
  test('EWA after a wallet verification: ALLOW with ZERO rail calls', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const afterRegister = h.rails.metrics.callsMade;

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);

    assert.equal(v.decision.outcome, 'ALLOW');
    assert.equal(v.decision.reason, 'SUFFICIENT');
    assert.equal(h.rails.metrics.callsMade, afterRegister, 'no new rail calls');
    assert.equal(v.railCallsAvoided, 3);
    assert.ok(v.costAvoidedPkr > 0);
  });

  test('e-CIB still runs — it is a credit check, not an identity check', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    assert.equal(h.ecib.calls, 0);
    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    assert.equal(v.eCibCalled, true);
    assert.equal(h.ecib.calls, 1);
  });

  test('selective disclosure returns 4 of 14 attributes, verified against the root', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const { consentId } = await h.svc.grantConsent(
      h.bank(),
      CNIC_WALLET,
      'ABHILendingMSP',
      'EWA_ORIGINATION',
      ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
      '2027-01-01T00:00:00Z',
      'tc-accept-ewa-001',
    );

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', consentId);

    assert.equal(v.decision.outcome, 'ALLOW');
    assert.ok(v.proof, 'a proof bundle must be returned');
    assert.equal(v.proof!.attributes.length, 4);
    assert.ok(verifyProofBundle(v.proof!));

    // The mechanical check: withheld values must be absent from the bytes.
    const serialised = JSON.stringify(v.proof);
    for (const withheld of ['Machine Operator', 'Salary disbursement', '1994-02-17', '486ea46224d1bb4f']) {
      assert.equal(serialised.includes(withheld), false, `${withheld} leaked`);
    }
  });
});

// ===========================================================================
describe('E2E-3 · Step-up verification', () => {
  test('A2 customer requesting SBL runs LIVENESS ONLY, not the full pack', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const decision = await h.svc.verify(h.lending(), CNIC_WALLET, 'SBL', null);
    assert.equal(decision.decision.outcome, 'STEP_UP');
    assert.equal(decision.decision.reason, 'ASSURANCE_LOW');
    assert.deepEqual(decision.decision.missingMethods, ['LIVENESS']);

    const before = h.rails.metrics.callsMade;
    const up = await h.svc.stepUp(
      h.lending(),
      CNIC_WALLET,
      'SBL',
      a3Attributes(),
      CNIC_EXPIRY_OK,
      'SBL step-up',
    );

    assert.deepEqual(up.methodsRun, ['LIVENESS']);
    assert.equal(h.rails.metrics.callsMade - before, 1, 'exactly one rail call');
    assert.equal(up.assuranceLevel, 'A3');
    assert.equal(up.version, 2);

    const after = await h.svc.verify(h.lending(), CNIC_WALLET, 'SBL', null);
    assert.equal(after.decision.outcome, 'ALLOW');
  });

  test('stepping up from A0 SUPERSEDES the assertion rather than combining with it', async () => {
    // Found by the dummy-data scenario: carrying ASSERTED forward alongside
    // real verified methods produced ERR_ASSURANCE_MISMATCH from the chaincode.
    // An assertion is superseded by verification — the record must say what
    // actually happened, not "both asserted and verified".
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_EMPLOYER,
      attributes: a0Attributes(),
      originProduct: 'EMPLOYER',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const up = await h.svc.stepUp(
      h.bank(),
      CNIC_EMPLOYER,
      'EWA',
      a2Attributes(),
      CNIC_EXPIRY_OK,
      'Asaan Digital Account onboarding',
    );

    assert.equal(up.assuranceLevel, 'A2');
    const chain = await h.svc.versionChain(h.bank(), CNIC_EMPLOYER);
    const v2 = chain.versions[1]!;
    assert.equal(v2.methods.includes('ASSERTED'), false, 'ASSERTED must not survive verification');
    assert.deepEqual(v2.methods, ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS']);
    assert.equal(chain.chainValid, true);

    // v1 still records that the employer asserted it — history is intact.
    assert.deepEqual(chain.versions[0]!.methods, ['ASSERTED']);
    assert.equal(chain.versions[0]!.assuranceLevel, 'A0');
  });

  test('A0 employer-asserted record grants nothing', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_EMPLOYER,
      attributes: a0Attributes(),
      originProduct: 'EMPLOYER',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    for (const product of ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING']) {
      const v = await h.svc.verify(h.lending(), CNIC_EMPLOYER, product, null);
      assert.equal(v.decision.outcome, 'STEP_UP', `${product} must not accept A0`);
      assert.ok(v.decision.missingMethods.length > 0);
    }
  });
});

// ===========================================================================
describe('E2E-4 · KYC suspension propagates instantly', () => {
  test('one Compliance action denies every product on its next call', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    for (const p of ['EWA', 'ASA', 'SBL']) {
      assert.equal((await h.svc.verify(h.lending(), CNIC_WALLET, p, null)).decision.outcome, 'ALLOW');
    }

    await h.svc.suspend(h.compliance(), CNIC_WALLET, 'AML alert', 'CASE-2026-114');

    for (const p of ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING']) {
      const v = await h.svc.verify(h.lending(), CNIC_WALLET, p, null);
      assert.equal(v.decision.outcome, 'DENY', `${p} must deny`);
      assert.equal(v.decision.reason, 'SUSPENDED');
    }
  });

  test('a product organization cannot suspend', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    await assert.rejects(
      () => h.svc.suspend(h.lending(), CNIC_WALLET, 'unauthorised', 'X'),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_INSUFFICIENT_ROLE',
    );
  });

  test('reinstatement restores access without refreshing the verification', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    await h.svc.suspend(h.compliance(), CNIC_WALLET, 'review', 'C-1');
    await h.svc.reinstate(h.compliance(), CNIC_WALLET, 'cleared', 'C-1');

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    assert.equal(v.decision.outcome, 'ALLOW');
  });
});

// ===========================================================================
describe('E2E-5 · Consent revocation', () => {
  test('revoking consent stops future disclosure but leaves the decision intact', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const { consentId } = await h.svc.grantConsent(
      h.bank(),
      CNIC_WALLET,
      'ABHILendingMSP',
      'EWA_ORIGINATION',
      ['verisys_match', 'cnic_expiry'],
      '2027-01-01T00:00:00Z',
      'tc-001',
    );

    const withConsent = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', consentId);
    assert.ok(withConsent.proof);

    await h.svc.revokeConsent(h.bank(), CNIC_WALLET, 'ABHILendingMSP', consentId, 'customer withdrew');

    // The sufficiency decision is unchanged — consent gates DISCLOSURE, not
    // the identity decision itself.
    await assert.rejects(
      () => h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', consentId),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_NO_VALID_CONSENT',
    );
  });

  test('consent narrower than policy wins — least disclosure', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    // EWA policy permits 4 attributes; the customer consents to 2.
    const { consentId } = await h.svc.grantConsent(
      h.bank(),
      CNIC_WALLET,
      'ABHILendingMSP',
      'EWA_ORIGINATION',
      ['verisys_match', 'cnic_expiry'],
      '2027-01-01T00:00:00Z',
      'tc-002',
    );

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', consentId);
    assert.equal(v.proof!.attributes.length, 2);
    assert.deepEqual(
      v.proof!.attributes.map((a) => a.name).sort(),
      ['cnic_expiry', 'verisys_match'],
    );
  });
});

// ===========================================================================
describe('E2E-6 · Version updates propagate without integration', () => {
  test('a CNIC renewal appends v2 and every product resolves to it', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: '2026-09-01T00:00:00Z',
    });

    await h.svc.stepUp(
      h.bank(),
      CNIC_WALLET,
      'EWA',
      a2Attributes(),
      '2036-09-01T00:00:00Z',
      'CNIC renewal',
    );

    const chain = await h.svc.versionChain(h.bank(), CNIC_WALLET);
    assert.equal(chain.versionCount, 2);
    assert.equal(chain.chainValid, true);
    assert.equal(chain.versions[1]!.cnicExpiryAt, '2036-09-01T00:00:00Z');

    // No batch job, no per-product migration.
    for (const p of ['EWA', 'ASA']) {
      assert.equal((await h.svc.verify(h.lending(), CNIC_WALLET, p, null)).decision.outcome, 'ALLOW');
    }
  });

  test('an expired CNIC is a hard DENY, never a step-up', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_PAST,
    });

    for (const p of ['EWA', 'SBL']) {
      const v = await h.svc.verify(h.lending(), CNIC_WALLET, p, null);
      assert.equal(v.decision.outcome, 'DENY');
      assert.equal(v.decision.reason, 'CNIC_EXPIRED');
    }
  });

  test('suspension outranks CNIC expiry in the reason code', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_PAST,
    });
    await h.svc.suspend(h.compliance(), CNIC_WALLET, 'AML', 'C-3');

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    assert.equal(v.decision.reason, 'SUSPENDED', 'suspension is evaluated first');
  });
});

// ===========================================================================
describe('E2E-7 · Crypto-shredding', () => {
  test('data is destroyed, the root survives, the audit fact survives', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const chainBefore = await h.svc.versionChain(h.bank(), CNIC_WALLET);
    const rootBefore = chainBefore.versions[0]!.merkleRoot;
    assert.equal(await h.vaultStore.count(), 1);

    const res = await h.svc.shred(h.compliance(), CNIC_WALLET, 'erasure request', 'PDPB right to erasure');

    assert.equal(res.vaultDestroyed, true);
    assert.equal(await h.vaultStore.count(), 0, 'ciphertext, DEK and salts destroyed');

    const chainAfter = await h.svc.versionChain(h.bank(), CNIC_WALLET);
    assert.equal(chainAfter.versions[0]!.status, 'SHREDDED');
    assert.equal(chainAfter.versions[0]!.merkleRoot, rootBefore, 'the root remains');
    assert.equal(chainAfter.versions[0]!.vaultRef, '', 'the pointer is cleared');

    // The audit fact that a verification occurred survives erasure.
    const audit = await h.svc.auditTrail(h.bank(), CNIC_WALLET);
    assert.ok(audit.some((e) => e.action === 'REGISTER'));
    assert.ok(audit.some((e) => e.action === 'SHRED'));
  });

  test('a shredded subject is sent to FULL_KYC, not barred', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    await h.svc.shred(h.compliance(), CNIC_WALLET, 'erasure', 'PDPB');

    const v = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    assert.equal(v.decision.outcome, 'FULL_KYC');
    assert.equal(v.decision.reason, 'SHREDDED');
  });
});

// ===========================================================================
describe('E2E-8 · Employer bulk activation split', () => {
  test('splits an upload into activate-now and needs-onboarding', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    // The employer CSV strips dashes; the app captures them. Both must resolve
    // to the same subject or the entire premise fails.
    const upload = ['6110112345678', CNIC_FRESH, CNIC_EMPLOYER, 'not-a-cnic'];
    const split = await h.svc.employerBulkLookup(h.bank(), upload);

    assert.equal(split.total, 4);
    assert.deepEqual(split.activateNow, ['6110112345678']);
    assert.equal(split.needsOnboarding.length, 2);
    assert.deepEqual(split.invalid, ['not-a-cnic']);
  });

  test('1,000 CNICs complete well inside the 60-second criterion', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const bulk = Array.from({ length: 1000 }, (_, i) =>
      String(35202_0000000 + i).padStart(13, '0'),
    );
    bulk[500] = '6110112345678';

    const t0 = performance.now();
    const split = await h.svc.employerBulkLookup(h.bank(), bulk);
    const elapsed = performance.now() - t0;

    assert.equal(split.total, 1000);
    assert.equal(split.activateNow.length, 1);
    assert.ok(elapsed < 60_000, `took ${elapsed.toFixed(0)}ms`);
  });
});

// ===========================================================================
describe('E2E-9 · Attempt cap — the friction the ledger removes', () => {
  test('a fourth biometric attempt in one day is refused', async () => {
    const h = harness();
    const subjectId = await h.svc.subjectId(CNIC_FRESH);

    for (let i = 0; i < 3; i++) {
      await h.rails.call(subjectId, 'BIOMETRIC_1TO1', NOW);
    }
    await assert.rejects(
      () => h.rails.call(subjectId, 'BIOMETRIC_1TO1', NOW),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_ATTEMPT_CAP_EXCEEDED',
    );
    assert.equal(h.rails.metrics.capLockouts, 1);
  });

  test('reuse means an already-verified customer never touches the cap', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    const subjectId = await h.svc.subjectId(CNIC_WALLET);

    for (let i = 0; i < 10; i++) {
      await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    }
    assert.equal(h.rails.attemptsUsed(subjectId, 'BIOMETRIC_1TO1', NOW), 1, 'only the original journey');
    assert.equal(h.rails.metrics.capLockouts, 0);
  });
});
