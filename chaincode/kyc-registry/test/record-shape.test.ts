import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSURANCE_LEVELS,
  RECORD_STATUSES,
  assertNoPII,
  type KYCRecord,
} from '@abhi/types';
import { MemoryStateStore } from '../src/memory-state.ts';
import { registerKYC, updateKYC, suspendKYC, markShredded, hashRecordAsStored } from '../src/registry.ts';
import {
  SUBJECT_A,
  VAULT_REF_2,
  METHODS,
  registerInput,
  storeWithSubject,
  compliance,
  readRecord,
  demoRoot,
} from './helpers.ts';

/**
 * On-chain state conformance audit.
 *
 * The `KYCRecord` interface is the entire contract between the ledger and
 * every consuming product, and it is the thing an auditor will read first. The
 * existing suite tests what the chaincode DOES; this one tests what it STORES
 * — that the four load-bearing fields are present, correctly typed, and drawn
 * from the closed value sets, on a record actually read back out of state
 * rather than on a constructed object.
 *
 * The distinction matters: a serialisation change that dropped `merkleRoot`
 * from the stored form would leave most behavioural tests green, because they
 * assert on values the functions return rather than on the bytes in state.
 */

// ===========================================================================
describe('AUDIT-3 · on-chain KYCRecord state', () => {
  test('a stored record carries merkleRoot, assuranceLevel, status and previousVersionHash', async () => {
    const { store } = await storeWithSubject();
    const r = await readRecord(store, SUBJECT_A, 1);

    assert.equal(r.docType, 'KYCRecord');
    assert.match(r.merkleRoot, /^[0-9a-f]{64}$/);
    assert.equal(r.merkleRoot, demoRoot());
    assert.ok(ASSURANCE_LEVELS.includes(r.assuranceLevel), `unknown level ${r.assuranceLevel}`);
    assert.ok(RECORD_STATUSES.includes(r.status), `unknown status ${r.status}`);
    // v1 has no predecessor. The field must EXIST and be null, not be absent —
    // an absent field and a null field serialise differently and a verifier
    // walking the chain has to distinguish "genesis" from "field missing".
    assert.ok('previousVersionHash' in r);
    assert.equal(r.previousVersionHash, null);
  });

  test('assuranceLevel is drawn from A0..A3 and nothing else', async () => {
    for (const level of ASSURANCE_LEVELS) {
      const store = new MemoryStateStore();
      await registerKYC(
        store,
        compliance(),
        registerInput({ assuranceLevel: level, methods: METHODS[level] }),
      );
      assert.equal((await readRecord(store, SUBJECT_A, 1)).assuranceLevel, level);
    }
    assert.deepEqual([...ASSURANCE_LEVELS], ['A0', 'A1', 'A2', 'A3']);
  });

  test('status covers ACTIVE, SUSPENDED, SUPERSEDED and SHREDDED, reachable in state', async () => {
    assert.deepEqual([...RECORD_STATUSES], ['ACTIVE', 'SUSPENDED', 'SUPERSEDED', 'SHREDDED']);

    // ACTIVE, then SUPERSEDED on the predecessor once v2 lands.
    const { store, ctx } = await storeWithSubject();
    assert.equal((await readRecord(store, SUBJECT_A, 1)).status, 'ACTIVE');

    await updateKYC(store, ctx, {
      subjectId: SUBJECT_A,
      expectedCurrentVersion: 1,
      merkleRoot: 'c'.repeat(64),
      attributeSetId: (await readRecord(store, SUBJECT_A, 1)).attributeSetId,
      assuranceLevel: 'A3',
      methods: METHODS.A3,
      expiresAt: '2027-08-17T10:00:00Z',
      cnicExpiryAt: '2031-04-11T00:00:00Z',
      vaultRef: VAULT_REF_2,
      updateReason: 'step-up to A3',
    });
    assert.equal((await readRecord(store, SUBJECT_A, 1)).status, 'SUPERSEDED');
    assert.equal((await readRecord(store, SUBJECT_A, 2)).status, 'ACTIVE');

    // SUSPENDED.
    const s = await storeWithSubject();
    await suspendKYC(s.store, compliance(), SUBJECT_A, 'AML alert', 'CASE-2026-114');
    assert.equal((await readRecord(s.store, SUBJECT_A, 1)).status, 'SUSPENDED');

    // SHREDDED.
    const d = await storeWithSubject();
    await markShredded(
      d.store,
      compliance(),
      SUBJECT_A,
      'erasure request',
      'PDPB Art.X',
      'SHRED-CERT-1',
    );
    assert.equal((await readRecord(d.store, SUBJECT_A, 1)).status, 'SHREDDED');
  });

  test('previousVersionHash links v(n) to v(n-1) as stored', async () => {
    const { store, ctx } = await storeWithSubject();
    const v1AsStored = await readRecord(store, SUBJECT_A, 1);

    await updateKYC(store, ctx, {
      subjectId: SUBJECT_A,
      expectedCurrentVersion: 1,
      merkleRoot: 'd'.repeat(64),
      attributeSetId: v1AsStored.attributeSetId,
      assuranceLevel: 'A3',
      methods: METHODS.A3,
      expiresAt: '2027-08-17T10:00:00Z',
      cnicExpiryAt: '2031-04-11T00:00:00Z',
      vaultRef: VAULT_REF_2,
      updateReason: 'step-up to A3',
    });

    const v2 = await readRecord(store, SUBJECT_A, 2);
    assert.match(v2.previousVersionHash ?? '', /^[0-9a-f]{64}$/);
    // The link hashes the predecessor AS IT NOW SITS IN STATE — after its
    // status flipped to SUPERSEDED — not as it looked when written.
    const v1Now = await readRecord(store, SUBJECT_A, 1);
    assert.equal(v2.previousVersionHash, hashRecordAsStored(v1Now));
    assert.notEqual(v2.previousVersionHash, hashRecordAsStored(v1AsStored));
  });

  test('the stored record holds no attribute values and no PII', async () => {
    const { store } = await storeWithSubject();
    const r = await readRecord(store, SUBJECT_A, 1);

    // The ledger holds proof, not data. Only the root crosses the boundary.
    const serialised = JSON.stringify(r);
    assert.doesNotMatch(serialised, /Machine Operator|Salary disbursement/);
    assertNoPII(r);
  });

  test('every declared KYCRecord field is present in state — none is optional', async () => {
    const { store } = await storeWithSubject();
    const r = await readRecord(store, SUBJECT_A, 1);

    const required: (keyof KYCRecord)[] = [
      'docType', 'subjectId', 'version', 'previousVersionHash', 'merkleRoot',
      'attributeSetId', 'assuranceLevel', 'methods', 'verifiedBy', 'verifiedAt',
      'expiresAt', 'cnicExpiryAt', 'status', 'statusReason', 'vaultRef',
      'pepperEpoch', 'originProduct', 'createdTxId', 'schemaVersion',
    ];
    for (const f of required) assert.ok(f in r, `KYCRecord.${f} is missing from stored state`);
  });
});
