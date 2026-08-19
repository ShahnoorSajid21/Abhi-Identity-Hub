import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockCbs } from '../src/cbs.ts';
import { PresentationStore } from '../src/presentation.ts';
import { planCohort, COHORT } from '../src/seed-cohort.ts';
import { harness, a2Attributes, CNIC_WALLET, CNIC_EXPIRY_OK } from '../../../tests/fixture.ts';

const NOW = new Date('2026-08-18T10:00:00Z');

describe('core banking profile mock', () => {
  test('a profile lookup does not move the spend counter', async () => {
    const h = harness();
    const cbs = new MockCbs();

    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const before = { ...h.rails.metrics };
    const subjectId = await h.svc.subjectId(CNIC_WALLET);

    await cbs.profile(subjectId);
    await cbs.profiles([subjectId, subjectId, subjectId]);

    const after = h.rails.metrics;

    // This is the guarantee behind "PKR 0" on a reuse. If an internal read
    // starts charging, that claim becomes false and nobody notices until
    // somebody in the room adds the numbers up.
    assert.equal(after.callsMade, before.callsMade, 'CBS lookup made a rail call');
    assert.equal(after.costSpentPkr, before.costSpentPkr, 'CBS lookup cost money');
  });

  test('profiles are deterministic — the same customer twice is the same person', async () => {
    const cbs = new MockCbs();
    const id = 'a'.repeat(64);
    const first = await cbs.profile(id);
    const second = await cbs.profile(id);
    assert.deepEqual(first, second);
  });

  test('different subjects get different people', async () => {
    const cbs = new MockCbs();
    const ids = Array.from({ length: 50 }, (_, i) => String(i).padStart(64, 'b'));
    const profiles = await cbs.profiles(ids);
    const names = new Set(profiles.map((p) => p.displayName));
    // Collisions are expected from a finite name list; a single name for all
    // fifty would mean the hash is not mixing.
    assert.ok(names.size > 10, `expected varied names, got ${names.size}`);
  });

  test('no profile field contains anything CNIC-shaped', async () => {
    const cbs = new MockCbs();
    const ids = Array.from({ length: 200 }, (_, i) => String(i).padStart(64, 'c'));
    for (const profile of await cbs.profiles(ids)) {
      assert.equal(/\d{13}/.test(JSON.stringify(profile)), false);
    }
  });
});

describe('cohort generator', () => {
  test('is deterministic across runs', () => {
    assert.deepEqual(planCohort(NOW), planCohort(NOW));
  });

  test('produces the documented distribution', () => {
    const plan = planCohort(NOW);
    const counts = { A0: 0, A1: 0, A2: 0, A3: 0 };
    for (const subject of plan) counts[subject.level] += 1;
    assert.deepEqual(counts, COHORT);
  });

  test('every generated CNIC is 13 digits and none is a repeated-digit value', () => {
    for (const subject of planCohort(NOW)) {
      const digits = subject.cnic.replace(/\D/g, '');
      assert.equal(digits.length, 13, `${subject.cnic} is not 13 digits`);
      assert.equal(/^(\d)\1{12}$/.test(digits), false);
    }
  });

  test('the levels are interleaved, not grouped', () => {
    // A directory whose first page is 357 unchecked customers in a row looks
    // generated, because it would be.
    const first50 = planCohort(NOW).slice(0, 50);
    assert.ok(new Set(first50.map((s) => s.level)).size > 1);
  });
});

describe('presentation store', () => {
  test('is an index, and says so — nothing survives a reset', () => {
    const store = new PresentationStore();
    store.recordActivity({
      at: NOW.toISOString(),
      actorMsp: 'ABHIComplianceMSP',
      actorRole: 'compliance',
      action: 'FROZEN',
      subjectId: 'd'.repeat(64),
      productId: null,
      decision: null,
      detail: 'test',
    });
    assert.equal(store.activity().length, 1);
    store.reset();
    assert.equal(store.activity().length, 0);
  });

  test('queue counts agree with the queue itself', () => {
    const store = new PresentationStore();
    const base = {
      subjectId: 'e'.repeat(64),
      productId: 'EWA',
      requestedAt: NOW.toISOString(),
      decisionReason: 'SUFFICIENT' as const,
      missingMethods: [],
      currentAssurance: 'A2',
      requiredAssurance: 'A2',
      ageDays: 10,
      policyId: 'EWA@v1',
      railCallsAvoided: 3,
      costAvoidedPkr: 80,
      disclosedAttributes: [],
    };

    store.recordVerification({ ...base, decision: 'ALLOW' });
    store.recordVerification({ ...base, decision: 'ALLOW' });
    store.recordVerification({ ...base, decision: 'STEP_UP' });

    const counts = store.queueCounts();
    assert.equal(counts.ALLOW, 2);
    assert.equal(counts.STEP_UP, 1);
    assert.equal(counts.ALLOW + counts.STEP_UP + counts.FULL_KYC + counts.DENY, store.queue().length);
  });

  test('a resolved request leaves the queue', () => {
    const store = new PresentationStore();
    const request = store.recordVerification({
      subjectId: 'f'.repeat(64),
      productId: 'SBL',
      requestedAt: NOW.toISOString(),
      decision: 'STEP_UP',
      decisionReason: 'ASSURANCE_LOW',
      missingMethods: ['LIVENESS'],
      currentAssurance: 'A2',
      requiredAssurance: 'A3',
      ageDays: 5,
      policyId: 'SBL@v1',
      railCallsAvoided: 3,
      costAvoidedPkr: 80,
      disclosedAttributes: [],
    });

    assert.equal(store.queue().length, 1);
    assert.equal(store.resolve(request.requestId, NOW.toISOString()), true);
    assert.equal(store.queue().length, 0);
    assert.equal(store.queue({ includeResolved: true }).length, 1);
  });
});
