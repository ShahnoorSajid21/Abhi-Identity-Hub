// FICTIONAL-CNIC-OK: fictional CNIC proving the chaincode PII tripwire rejects it. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJSON } from '@abhi/canonical';
import { sha256Hex, generateProofBundle, demoAttributes, ATTRIBUTE_SET_ID } from '@abhi/merkle';
import { KycError } from '@abhi/types';
import { PRODUCT_POLICIES } from '@abhi/policy';
import { MemoryStateStore, memoryContext } from '../src/memory-state.ts';
import {
  registerKYC,
  verifyKYC,
  updateKYC,
  suspendKYC,
  reinstateKYC,
  recordConsent,
  revokeConsent,
  markShredded,
  getVersionChain,
  generateProof,
  verifyProof,
  hashRecordAsStored,
} from '../src/registry.ts';
import {
  SUBJECT_A,
  VAULT_REF_2,
  METHODS,
  KNOWN_ATTRIBUTES,
  registerInput,
  storeWithSubject,
  compliance,
  lending,
  bank,
  readRecord,
  tamperRecord,
  demoRoot,
} from './helpers.ts';

const expectCode = async (fn: () => Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(fn, (e: unknown) => {
    assert.ok(e instanceof KycError, `expected KycError, got ${String(e)}`);
    assert.equal(e.code, code);
    return true;
  });
};

// ===========================================================================
describe('RegisterKYC', () => {
  test('creates version 1 with a null previousVersionHash', async () => {
    const { store } = await storeWithSubject();
    const r = await readRecord(store, SUBJECT_A, 1);
    assert.equal(r.version, 1);
    assert.equal(r.previousVersionHash, null);
    assert.equal(r.status, 'ACTIVE');
    assert.equal(r.assuranceLevel, 'A2');
  });

  test('verifiedBy comes from the caller MSP, not the payload', async () => {
    const store = new MemoryStateStore();
    await registerKYC(store, lending(), registerInput());
    assert.equal((await readRecord(store, SUBJECT_A, 1)).verifiedBy, 'ABHILendingMSP');
  });

  test('verifiedAt comes from the transaction timestamp, not a client clock', async () => {
    const store = new MemoryStateStore();
    const ctx = memoryContext({ timestamp: new Date('2026-01-02T03:04:05Z') });
    await registerKYC(store, ctx, registerInput());
    assert.equal((await readRecord(store, SUBJECT_A, 1)).verifiedAt, '2026-01-02T03:04:05Z');
  });

  test('rejects a duplicate subject — no chain reset', async () => {
    const { store } = await storeWithSubject();
    await expectCode(() => registerKYC(store, bank(), registerInput()), 'ERR_SUBJECT_EXISTS');
  });

  test('emits KYCRegistered', async () => {
    const store = new MemoryStateStore();
    const ctx = memoryContext();
    await registerKYC(store, ctx, registerInput());
    assert.equal(ctx.events[0]?.name, 'KYCRegistered');
  });
});

// ===========================================================================
describe('assurance/method consistency — closes assurance inflation', () => {
  test('A3 without LIVENESS is rejected', async () => {
    const store = new MemoryStateStore();
    await expectCode(
      () =>
        registerKYC(
          store,
          bank(),
          registerInput({ assuranceLevel: 'A3', methods: METHODS.A2 }),
        ),
      'ERR_ASSURANCE_MISMATCH',
    );
  });

  test('A2 without BIOMETRIC_1TO1 is rejected', async () => {
    const store = new MemoryStateStore();
    await expectCode(
      () => registerKYC(store, bank(), registerInput({ assuranceLevel: 'A2', methods: METHODS.A1 })),
      'ERR_ASSURANCE_MISMATCH',
    );
  });

  test('A0 carrying a verified method is rejected', async () => {
    const store = new MemoryStateStore();
    await expectCode(
      () =>
        registerKYC(store, bank(), registerInput({ assuranceLevel: 'A0', methods: ['ASSERTED', 'VERISYS'] })),
      'ERR_ASSURANCE_MISMATCH',
    );
  });

  test('unsorted methods are rejected', async () => {
    const store = new MemoryStateStore();
    await expectCode(
      () =>
        registerKYC(
          store,
          bank(),
          registerInput({ assuranceLevel: 'A2', methods: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'] }),
        ),
      'ERR_INVALID_METHODS',
    );
  });
});

// ===========================================================================
describe('PII tripwire', () => {
  test('rejects any payload containing a 13-digit run', async () => {
    const store = new MemoryStateStore();
    await expectCode(
      () => registerKYC(store, bank(), registerInput({ originProduct: 'WALLET-6110112345678' })),
      'ERR_PII_DETECTED',
    );
  });

  test('does not false-positive on 64-hex subject IDs and roots', async () => {
    const { store } = await storeWithSubject({ subjectId: '1234567890123456'.repeat(4) });
    assert.ok(await store.get(`SUBJ~${'1234567890123456'.repeat(4)}`));
  });
});

// ===========================================================================
describe('UpdateKYC and the version chain', () => {
  test('chain-hash-post-supersession: link hashes the predecessor AS STORED', async () => {
    const { store } = await storeWithSubject();

    await updateKYC(store, bank(), {
      subjectId: SUBJECT_A,
      expectedCurrentVersion: 1,
      merkleRoot: demoRoot(),
      attributeSetId: ATTRIBUTE_SET_ID,
      assuranceLevel: 'A3',
      methods: METHODS.A3,
      expiresAt: '2027-08-17T10:00:00Z',
      cnicExpiryAt: '2031-04-11T00:00:00Z',
      vaultRef: VAULT_REF_2,
      updateReason: 'SBL step-up',
    });

    const v1 = await readRecord(store, SUBJECT_A, 1);
    const v2 = await readRecord(store, SUBJECT_A, 2);

    assert.equal(v1.status, 'SUPERSEDED', 'v1 must be persisted as SUPERSEDED');
    assert.equal(v2.previousVersionHash, sha256Hex(canonicalJSON(v1)));
    assert.equal(v2.previousVersionHash, hashRecordAsStored(v1));

    // The pre-supersession form must NOT be what was hashed.
    const preSupersession = sha256Hex(canonicalJSON({ ...v1, status: 'ACTIVE' }));
    assert.notEqual(v2.previousVersionHash, preSupersession);
  });

  test('rejects a stale expectedCurrentVersion (optimistic concurrency)', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () =>
        updateKYC(store, bank(), {
          subjectId: SUBJECT_A,
          expectedCurrentVersion: 7,
          merkleRoot: demoRoot(),
          attributeSetId: ATTRIBUTE_SET_ID,
          assuranceLevel: 'A2',
          methods: METHODS.A2,
          expiresAt: '2027-08-17T10:00:00Z',
          cnicExpiryAt: '2031-04-11T00:00:00Z',
          vaultRef: VAULT_REF_2,
          updateReason: 'x',
        }),
      'ERR_VERSION_CONFLICT',
    );
  });

  test('permits an assurance downgrade — the truth is not discarded', async () => {
    const { store } = await storeWithSubject({ assuranceLevel: 'A3', methods: METHODS.A3 });
    const r = await updateKYC(store, bank(), {
      subjectId: SUBJECT_A,
      expectedCurrentVersion: 1,
      merkleRoot: demoRoot(),
      attributeSetId: ATTRIBUTE_SET_ID,
      assuranceLevel: 'A1',
      methods: METHODS.A1,
      expiresAt: '2027-08-17T10:00:00Z',
      cnicExpiryAt: '2031-04-11T00:00:00Z',
      vaultRef: VAULT_REF_2,
      updateReason: 'biometric re-verification failed',
    });
    assert.equal(r.version, 2);
    assert.equal((await readRecord(store, SUBJECT_A, 2)).assuranceLevel, 'A1');
  });

  test('carries a suspension forward onto the new version', async () => {
    const { store } = await storeWithSubject();
    await suspendKYC(store, compliance(), SUBJECT_A, 'AML review', 'CASE-1');
    await updateKYC(store, bank(), {
      subjectId: SUBJECT_A,
      expectedCurrentVersion: 1,
      merkleRoot: demoRoot(),
      attributeSetId: ATTRIBUTE_SET_ID,
      assuranceLevel: 'A2',
      methods: METHODS.A2,
      expiresAt: '2027-08-17T10:00:00Z',
      cnicExpiryAt: '2031-04-11T00:00:00Z',
      vaultRef: VAULT_REF_2,
      updateReason: 'CNIC renewal while under review',
    });
    assert.equal((await readRecord(store, SUBJECT_A, 2)).status, 'SUSPENDED');
  });

  test('a 3-version chain verifies end to end', async () => {
    const { store } = await storeWithSubject();
    for (const [v, reason] of [
      [1, 'SBL step-up'],
      [2, 'CNIC renewal'],
    ] as const) {
      await updateKYC(store, bank(), {
        subjectId: SUBJECT_A,
        expectedCurrentVersion: v,
        merkleRoot: demoRoot(),
        attributeSetId: ATTRIBUTE_SET_ID,
        assuranceLevel: 'A3',
        methods: METHODS.A3,
        expiresAt: '2027-08-17T10:00:00Z',
        cnicExpiryAt: '2031-04-11T00:00:00Z',
        vaultRef: VAULT_REF_2,
        updateReason: reason,
      });
    }
    const chain = await getVersionChain(store, bank(), SUBJECT_A);
    assert.equal(chain.versionCount, 3);
    assert.equal(chain.chainValid, true);
    assert.equal(chain.brokenAt, null);
    assert.deepEqual(chain.versions.map((v) => v.version), [1, 2, 3]);
  });
});

// ===========================================================================
describe('tamper detection — attack scenario S-1', () => {
  test('a DBA upgrading a historical assurance level breaks the chain', async () => {
    const { store } = await storeWithSubject();
    await updateKYC(store, bank(), {
      subjectId: SUBJECT_A,
      expectedCurrentVersion: 1,
      merkleRoot: demoRoot(),
      attributeSetId: ATTRIBUTE_SET_ID,
      assuranceLevel: 'A3',
      methods: METHODS.A3,
      expiresAt: '2027-08-17T10:00:00Z',
      cnicExpiryAt: '2031-04-11T00:00:00Z',
      vaultRef: VAULT_REF_2,
      updateReason: 'step-up',
    });

    assert.equal((await getVersionChain(store, bank(), SUBJECT_A)).chainValid, true);

    // Malicious direct state write, bypassing chaincode entirely.
    await tamperRecord(store, SUBJECT_A, 1, (r) => ({
      ...r,
      assuranceLevel: 'A3',
      methods: METHODS.A3,
    }));

    const after = await getVersionChain(store, bank(), SUBJECT_A);
    assert.equal(after.chainValid, false);
    assert.equal(after.brokenAt, 2);
  });

  test('detects a gap in the version sequence', async () => {
    const { store } = await storeWithSubject();
    store.tamper(
      `KYC~${SUBJECT_A}~0000000003`,
      canonicalJSON({ ...(await readRecord(store, SUBJECT_A, 1)), version: 3 }),
    );
    await expectCode(() => getVersionChain(store, bank(), SUBJECT_A), 'ERR_CHAIN_GAP');
  });
});

// ===========================================================================
describe('SuspendKYC / ReinstateKYC — Compliance authority', () => {
  test('suspend-requires-compliance: Lending is rejected', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => suspendKYC(store, lending(), SUBJECT_A, 'attempt', 'X'),
      'ERR_INSUFFICIENT_ROLE',
    );
  });

  test('Compliance MSP without the officer role is rejected', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () =>
        suspendKYC(
          store,
          memoryContext({ mspId: 'ABHIComplianceMSP', role: 'gateway' }),
          SUBJECT_A,
          'attempt',
          'X',
        ),
      'ERR_INSUFFICIENT_ROLE',
    );
  });

  test('an officer role at a product MSP is still rejected', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () =>
        suspendKYC(
          store,
          memoryContext({ mspId: 'ABHILendingMSP', role: 'compliance-officer' }),
          SUBJECT_A,
          'attempt',
          'X',
        ),
      'ERR_COMPLIANCE_ONLY',
    );
  });

  test('suspension requires a reason and a reference', async () => {
    const { store } = await storeWithSubject();
    await expectCode(() => suspendKYC(store, compliance(), SUBJECT_A, '', 'X'), 'ERR_REASON_REQUIRED');
    await expectCode(() => suspendKYC(store, compliance(), SUBJECT_A, 'r', ''), 'ERR_REASON_REQUIRED');
  });

  test('reinstatement does not refresh assurance, expiry or verifiedAt', async () => {
    const { store } = await storeWithSubject();
    const before = await readRecord(store, SUBJECT_A, 1);

    await suspendKYC(store, compliance(), SUBJECT_A, 'AML review', 'CASE-9');
    await reinstateKYC(store, compliance(), SUBJECT_A, 'cleared', 'CASE-9');

    const after = await readRecord(store, SUBJECT_A, 1);
    assert.equal(after.status, 'ACTIVE');
    assert.equal(after.statusReason, null);
    assert.equal(after.assuranceLevel, before.assuranceLevel);
    assert.equal(after.expiresAt, before.expiresAt);
    assert.equal(after.verifiedAt, before.verifiedAt);
  });

  test('cannot reinstate a record that is not suspended', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => reinstateKYC(store, compliance(), SUBJECT_A, 'x', 'Y'),
      'ERR_INVALID_TRANSITION',
    );
  });
});

// ===========================================================================
describe('Consent', () => {
  const consentInput = {
    consentId: 'c1',
    subjectId: SUBJECT_A,
    grantedTo: 'ABHILendingMSP',
    purpose: 'EWA_ORIGINATION',
    scope: ['verisys_match', 'biometric_match'],
    expiresAt: '2027-01-01T00:00:00Z',
    evidenceRef: 'tc-accept-001',
  };

  test('records a consent with a sorted scope', async () => {
    const { store } = await storeWithSubject();
    await recordConsent(store, bank(), consentInput, KNOWN_ATTRIBUTES);
    const raw = await store.get(`CONS~${SUBJECT_A}~ABHILendingMSP~c1`);
    assert.deepEqual(JSON.parse(raw!).scope, ['biometric_match', 'verisys_match']);
  });

  test('rejects a wildcard scope', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => recordConsent(store, bank(), { ...consentInput, scope: ['*'] }, KNOWN_ATTRIBUTES),
      'ERR_INVALID_SCOPE',
    );
  });

  test('rejects an unknown attribute in scope', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => recordConsent(store, bank(), { ...consentInput, scope: ['nope'] }, KNOWN_ATTRIBUTES),
      'ERR_UNKNOWN_ATTRIBUTE',
    );
  });

  test('rejects perpetual consent beyond the maximum', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () =>
        recordConsent(
          store,
          bank(),
          { ...consentInput, expiresAt: '2099-01-01T00:00:00Z' },
          KNOWN_ATTRIBUTES,
        ),
      'ERR_INVALID_EXPIRY',
    );
  });

  test('requires evidence of the customer grant', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => recordConsent(store, bank(), { ...consentInput, evidenceRef: '' }, KNOWN_ATTRIBUTES),
      'ERR_EVIDENCE_REQUIRED',
    );
  });

  test('revocation is an append that leaves the grant visible', async () => {
    const { store } = await storeWithSubject();
    await recordConsent(store, bank(), consentInput, KNOWN_ATTRIBUTES);
    await revokeConsent(store, bank(), SUBJECT_A, 'ABHILendingMSP', 'c1', 'customer withdrew');

    const c = JSON.parse((await store.get(`CONS~${SUBJECT_A}~ABHILendingMSP~c1`))!);
    assert.equal(c.status, 'REVOKED');
    assert.equal(c.grantedAt !== null, true, 'the original grant remains visible');
    assert.equal(c.revocationReason, 'customer withdrew');
  });

  test('cannot revoke twice', async () => {
    const { store } = await storeWithSubject();
    await recordConsent(store, bank(), consentInput, KNOWN_ATTRIBUTES);
    await revokeConsent(store, bank(), SUBJECT_A, 'ABHILendingMSP', 'c1', 'r');
    await expectCode(
      () => revokeConsent(store, bank(), SUBJECT_A, 'ABHILendingMSP', 'c1', 'r'),
      'ERR_NO_VALID_CONSENT',
    );
  });
});

// ===========================================================================
describe('GenerateProof — least disclosure', () => {
  const setup = async () => {
    const { store } = await storeWithSubject();
    await recordConsent(
      store,
      bank(),
      {
        consentId: 'c1',
        subjectId: SUBJECT_A,
        grantedTo: 'ABHILendingMSP',
        purpose: 'EWA_ORIGINATION',
        // Customer consented to 3; policy permits 4; request asks for 5.
        scope: ['verisys_match', 'biometric_match', 'cnic_expiry'],
        expiresAt: '2027-01-01T00:00:00Z',
        evidenceRef: 'tc-001',
      },
      KNOWN_ATTRIBUTES,
    );
    return store;
  };

  test('grants only request ∩ consent ∩ policy — the narrowest wins', async () => {
    const store = await setup();
    const r = await generateProof(
      store,
      lending(),
      SUBJECT_A,
      'EWA',
      ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status', 'profession'],
      'c1',
      PRODUCT_POLICIES['EWA']!,
    );
    assert.deepEqual(r.grantedAttributes, ['biometric_match', 'cnic_expiry', 'verisys_match']);
    // fatca_status: in policy but NOT in consent. profession: in neither.
    assert.deepEqual(r.denied, ['fatca_status', 'profession']);
  });

  test('records exactly which attributes were disclosed', async () => {
    const store = await setup();
    const ctx = lending();
    await generateProof(store, ctx, SUBJECT_A, 'EWA', ['verisys_match', 'profession'], 'c1', PRODUCT_POLICIES['EWA']!);
    const audit = (await store.getRange(`AEVT~${SUBJECT_A}~`, `AEVT~${SUBJECT_A}~\x7F`))
      .map((r) => JSON.parse(r.value))
      .find((e) => e.action === 'PROOF_ISSUED');
    assert.deepEqual(audit.attributesDisclosed, ['verisys_match']);
    assert.equal(audit.policyId, 'EWA@v1');
  });

  test('refuses without a valid consent', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => generateProof(store, lending(), SUBJECT_A, 'EWA', ['verisys_match'], 'nope', PRODUCT_POLICIES['EWA']!),
      'ERR_NO_VALID_CONSENT',
    );
  });

  test('refuses after consent is revoked', async () => {
    const store = await setup();
    await revokeConsent(store, bank(), SUBJECT_A, 'ABHILendingMSP', 'c1', 'withdrawn');
    await expectCode(
      () => generateProof(store, lending(), SUBJECT_A, 'EWA', ['verisys_match'], 'c1', PRODUCT_POLICIES['EWA']!),
      'ERR_NO_VALID_CONSENT',
    );
  });

  test('refuses on a suspended record', async () => {
    const store = await setup();
    await suspendKYC(store, compliance(), SUBJECT_A, 'AML', 'C-1');
    await expectCode(
      () => generateProof(store, lending(), SUBJECT_A, 'EWA', ['verisys_match'], 'c1', PRODUCT_POLICIES['EWA']!),
      'ERR_NOT_ACTIVE',
    );
  });
});

// ===========================================================================
describe('VerifyProof', () => {
  test('accepts a valid bundle matching the ledger root', async () => {
    const attrs = demoAttributes();
    const { store } = await storeWithSubject();
    const bundle = generateProofBundle(attrs, ['verisys_match', 'fatca_status'], ATTRIBUTE_SET_ID);
    const r = await verifyProof(store, lending(), SUBJECT_A, bundle);
    assert.equal(r.valid, true);
    assert.equal(r.rootMatchesLedger, true);
    assert.deepEqual(r.attributesVerified, ['fatca_status', 'verisys_match']);
  });

  test('rejects a bundle whose root is not the ledger root — replay defence', async () => {
    const { store } = await storeWithSubject();
    const bundle = generateProofBundle(demoAttributes(), ['verisys_match'], ATTRIBUTE_SET_ID);
    const stale = { ...bundle, merkleRoot: 'c'.repeat(64) };
    const r = await verifyProof(store, lending(), SUBJECT_A, stale);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'PROOF_VERIFICATION_FAILED');
  });

  test('rejects a cryptographically valid bundle once the record is suspended', async () => {
    const { store } = await storeWithSubject();
    const bundle = generateProofBundle(demoAttributes(), ['verisys_match'], ATTRIBUTE_SET_ID);
    await suspendKYC(store, compliance(), SUBJECT_A, 'AML', 'C-2');
    const r = await verifyProof(store, lending(), SUBJECT_A, bundle);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'RECORD_SUSPENDED');
  });
});

// ===========================================================================
describe('MarkShredded — crypto-shredding', () => {
  test('root survives, vault pointer is cleared, consents are revoked', async () => {
    const { store } = await storeWithSubject();
    await recordConsent(
      store,
      bank(),
      {
        consentId: 'c1',
        subjectId: SUBJECT_A,
        grantedTo: 'ABHILendingMSP',
        purpose: 'EWA',
        scope: ['verisys_match'],
        expiresAt: '2027-01-01T00:00:00Z',
        evidenceRef: 'e',
      },
      KNOWN_ATTRIBUTES,
    );

    const before = await readRecord(store, SUBJECT_A, 1);
    await markShredded(store, compliance(), SUBJECT_A, 'erasure request', 'PDPB Art.X', 'SHRED-CERT-1');

    const after = await readRecord(store, SUBJECT_A, 1);
    assert.equal(after.status, 'SHREDDED');
    assert.equal(after.vaultRef, '');
    assert.equal(after.merkleRoot, before.merkleRoot, 'the audit fact must survive');

    const c = JSON.parse((await store.get(`CONS~${SUBJECT_A}~ABHILendingMSP~c1`))!);
    assert.equal(c.status, 'REVOKED');
  });

  test('is Compliance-only', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => markShredded(store, lending(), SUBJECT_A, 'r', 'b', 'c'),
      'ERR_INSUFFICIENT_ROLE',
    );
  });

  test('requires a legal basis and a shred certificate', async () => {
    const { store } = await storeWithSubject();
    await expectCode(
      () => markShredded(store, compliance(), SUBJECT_A, 'r', '', 'c'),
      'ERR_LEGAL_BASIS_REQUIRED',
    );
    await expectCode(
      () => markShredded(store, compliance(), SUBJECT_A, 'r', 'b', ''),
      'ERR_EVIDENCE_REQUIRED',
    );
  });

  test('a shredded subject cannot be updated', async () => {
    const { store } = await storeWithSubject();
    await markShredded(store, compliance(), SUBJECT_A, 'r', 'b', 'c');
    await expectCode(
      () =>
        updateKYC(store, bank(), {
          subjectId: SUBJECT_A,
          expectedCurrentVersion: 1,
          merkleRoot: demoRoot(),
          attributeSetId: ATTRIBUTE_SET_ID,
          assuranceLevel: 'A2',
          methods: METHODS.A2,
          expiresAt: '2027-08-17T10:00:00Z',
          cnicExpiryAt: '2031-04-11T00:00:00Z',
          vaultRef: VAULT_REF_2,
          updateReason: 'x',
        }),
      'ERR_SHREDDED',
    );
  });
});

// ===========================================================================
describe('VerifyKYC', () => {
  test('returns found:false for an unknown subject', async () => {
    const store = new MemoryStateStore();
    const r = await verifyKYC(store, bank(), 'f'.repeat(64));
    assert.equal(r.found, false);
    assert.equal(r.version, null);
  });

  test('reports cnicExpired against the transaction timestamp', async () => {
    const { store } = await storeWithSubject({ cnicExpiryAt: '2026-01-01T00:00:00Z' });
    const r = await verifyKYC(store, bank(), SUBJECT_A);
    assert.equal(r.cnicExpired, true);
  });

  test('detects registry/record divergence', async () => {
    const { store } = await storeWithSubject();
    const raw = JSON.parse((await store.get(`SUBJ~${SUBJECT_A}`))!);
    store.tamper(`SUBJ~${SUBJECT_A}`, canonicalJSON({ ...raw, currentVersion: 99 }));
    await expectCode(() => verifyKYC(store, bank(), SUBJECT_A), 'ERR_REGISTRY_DIVERGENCE');
  });
});

// ===========================================================================
describe('unknown MSP', () => {
  test('a caller outside the network is rejected', async () => {
    const store = new MemoryStateStore();
    await expectCode(
      () => registerKYC(store, memoryContext({ mspId: 'RogueMSP' }), registerInput()),
      'ERR_UNKNOWN_MSP',
    );
  });
});
