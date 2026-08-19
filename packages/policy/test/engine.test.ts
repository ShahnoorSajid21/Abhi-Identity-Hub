import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { KYCRecord, AssuranceLevel, RecordStatus } from '@abhi/types';
import { decide, intersectDisclosure, missingMethodsFor, strongestMethod, PRODUCT_POLICIES } from '../src/index.ts';

const NOW = new Date('2026-08-17T10:00:00Z');

function record(over: Partial<KYCRecord> = {}): KYCRecord {
  return {
    docType: 'KYCRecord',
    subjectId: 'a'.repeat(64),
    version: 1,
    previousVersionHash: null,
    merkleRoot: 'b'.repeat(64),
    attributeSetId: 'ABHI-KYC-ATTRS-v1',
    assuranceLevel: 'A2',
    methods: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS'],
    verifiedBy: 'ABHIBankMSP',
    verifiedAt: '2026-06-07T10:00:00Z', // 71 days before NOW
    expiresAt: '2027-06-07T10:00:00Z',
    cnicExpiryAt: '2031-04-11T00:00:00Z',
    status: 'ACTIVE',
    statusReason: null,
    vaultRef: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    pepperEpoch: 1,
    originProduct: 'WALLET',
    createdTxId: 'tx',
    schemaVersion: 1,
    ...over,
  };
}

const EWA = PRODUCT_POLICIES['EWA']!;
const SBL = PRODUCT_POLICIES['SBL']!;

describe('decision table — exhaustive', () => {
  test('no record -> FULL_KYC', () => {
    const d = decide(null, EWA, NOW);
    assert.equal(d.outcome, 'FULL_KYC');
    assert.equal(d.reason, 'NO_RECORD');
    assert.deepEqual(d.missingMethods, ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']);
  });

  test('A2 within 365 days -> ALLOW for EWA', () => {
    const d = decide(record(), EWA, NOW);
    assert.equal(d.outcome, 'ALLOW');
    assert.equal(d.reason, 'SUFFICIENT');
    assert.equal(d.ageDays, 71);
    assert.deepEqual(d.disclosableAttributes, EWA.disclosableAttributes);
  });

  test('A2 requesting SBL -> STEP_UP naming liveness only', () => {
    const d = decide(record(), SBL, NOW);
    assert.equal(d.outcome, 'STEP_UP');
    assert.equal(d.reason, 'ASSURANCE_LOW');
    assert.deepEqual(d.missingMethods, ['LIVENESS']);
  });

  test('stale A2 -> STEP_UP re-affirming the strongest method only', () => {
    const d = decide(record({ verifiedAt: '2024-01-01T00:00:00Z' }), EWA, NOW);
    assert.equal(d.outcome, 'STEP_UP');
    assert.equal(d.reason, 'STALE');
    assert.deepEqual(d.missingMethods, ['BIOMETRIC_1TO1']);
  });

  test('SUSPENDED -> DENY, and it outranks everything', () => {
    const d = decide(
      record({ status: 'SUSPENDED', cnicExpiryAt: '2020-01-01T00:00:00Z', assuranceLevel: 'A0', methods: ['ASSERTED'] }),
      SBL,
      NOW,
    );
    assert.equal(d.outcome, 'DENY');
    assert.equal(d.reason, 'SUSPENDED');
  });

  test('SHREDDED -> FULL_KYC, not DENY', () => {
    const d = decide(record({ status: 'SHREDDED' }), EWA, NOW);
    assert.equal(d.outcome, 'FULL_KYC');
    assert.equal(d.reason, 'SHREDDED');
  });

  test('expired CNIC -> DENY, and it outranks assurance and staleness', () => {
    const d = decide(
      record({ cnicExpiryAt: '2025-01-01T00:00:00Z', assuranceLevel: 'A0', methods: ['ASSERTED'] }),
      SBL,
      NOW,
    );
    assert.equal(d.outcome, 'DENY');
    assert.equal(d.reason, 'CNIC_EXPIRED');
  });

  test('assurance is evaluated before staleness', () => {
    // Both too weak AND too old: the assurance gap is reported, because
    // satisfying it also refreshes the age.
    const d = decide(record({ verifiedAt: '2020-01-01T00:00:00Z' }), SBL, NOW);
    assert.equal(d.reason, 'ASSURANCE_LOW');
  });

  test('A0 satisfies no product', () => {
    for (const p of ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING', 'EMPLOYER_BULK']) {
      const d = decide(record({ assuranceLevel: 'A0', methods: ['ASSERTED'] }), PRODUCT_POLICIES[p]!, NOW);
      assert.notEqual(d.outcome, 'ALLOW', `${p} must not accept A0`);
    }
  });

  test('A3 satisfies every product', () => {
    const a3 = record({
      assuranceLevel: 'A3',
      methods: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'LIVENESS', 'VERISYS'],
    });
    for (const p of ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING', 'EMPLOYER_BULK']) {
      assert.equal(decide(a3, PRODUCT_POLICIES[p]!, NOW).outcome, 'ALLOW', p);
    }
  });

  test('determinism — same inputs always produce the same output', () => {
    const r = record();
    const a = decide(r, EWA, NOW);
    for (let i = 0; i < 50; i++) {
      assert.deepEqual(decide(r, EWA, NOW), a);
    }
  });

  test('every status x every level x both products yields a valid outcome', () => {
    const statuses: RecordStatus[] = ['ACTIVE', 'SUSPENDED', 'SUPERSEDED', 'SHREDDED'];
    const levels: AssuranceLevel[] = ['A0', 'A1', 'A2', 'A3'];
    const methodsFor: Record<AssuranceLevel, KYCRecord['methods']> = {
      A0: ['ASSERTED'],
      A1: ['DOC_AUTH', 'VERISYS'],
      A2: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS'],
      A3: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'LIVENESS', 'VERISYS'],
    };

    let count = 0;
    for (const status of statuses) {
      for (const level of levels) {
        for (const policy of [EWA, SBL]) {
          for (const expiry of ['2031-04-11T00:00:00Z', '2020-01-01T00:00:00Z']) {
            const d = decide(
              record({ status, assuranceLevel: level, methods: methodsFor[level], cnicExpiryAt: expiry }),
              policy,
              NOW,
            );
            assert.ok(['ALLOW', 'STEP_UP', 'FULL_KYC', 'DENY'].includes(d.outcome));
            assert.equal(typeof d.policyId, 'string');
            count++;
          }
        }
      }
    }
    assert.equal(count, 64);
  });
});

describe('step-up matrix', () => {
  test('A1 -> A2 requires biometric only', () => {
    assert.deepEqual(missingMethodsFor({ methods: ['DOC_AUTH', 'VERISYS'] }, 'A2'), ['BIOMETRIC_1TO1']);
  });

  test('A2 -> A3 requires liveness only', () => {
    assert.deepEqual(
      missingMethodsFor({ methods: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS'] }, 'A3'),
      ['LIVENESS'],
    );
  });

  test('A0 -> A3 requires the full pack', () => {
    assert.deepEqual(missingMethodsFor({ methods: ['ASSERTED'] }, 'A3'), [
      'VERISYS',
      'DOC_AUTH',
      'BIOMETRIC_1TO1',
      'LIVENESS',
    ]);
  });

  test('strongestMethod picks liveness over biometric over documents', () => {
    assert.equal(strongestMethod(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1', 'LIVENESS']), 'LIVENESS');
    assert.equal(strongestMethod(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']), 'BIOMETRIC_1TO1');
    assert.equal(strongestMethod(['VERISYS']), 'VERISYS');
  });
});

describe('least disclosure — three-way intersection', () => {
  test('the narrowest of request, consent and policy wins', () => {
    const r = intersectDisclosure(
      ['verisys_match', 'biometric_match', 'profession', 'address_hash'],
      ['verisys_match', 'biometric_match', 'profession'],
      ['verisys_match', 'biometric_match', 'cnic_expiry'],
    );
    assert.deepEqual(r.granted, ['biometric_match', 'verisys_match']);
    assert.deepEqual(r.denied, ['address_hash', 'profession']);
  });

  test('empty consent grants nothing', () => {
    const r = intersectDisclosure(['verisys_match'], [], ['verisys_match']);
    assert.deepEqual(r.granted, []);
  });

  test('policy cannot be widened by a generous consent', () => {
    const r = intersectDisclosure(['profession'], ['profession'], ['verisys_match']);
    assert.deepEqual(r.granted, []);
    assert.deepEqual(r.denied, ['profession']);
  });
});
