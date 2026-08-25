// FICTIONAL-CNIC-OK: fictional CNICs; SEC-04 regression needs a CNIC inside a 64-hex value. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KycError, assertNoPII, scanTextForPII } from '@abhi/types';
import { MAX_DISCLOSABLE_ATTRIBUTES } from '@abhi/policy';
import { MemoryStateStore, memoryContext } from '@abhi/kyc-registry';
import {
  registerKYC,
  recordConsent,
  getAuditTrail,
  type RegisterKYCInput,
} from '@abhi/kyc-registry';
import { ATTRIBUTE_NAMES, ATTRIBUTE_SET_ID, demoAttributes, merkleRootHex } from '@abhi/merkle';
import { harness, a2Attributes, CNIC_WALLET, CNIC_EXPIRY_OK } from '../fixture.ts';
import { redact, scrubString } from '../../services/gateway/src/logging.ts';

const SUBJECT = 'a'.repeat(64);
const KNOWN = [...ATTRIBUTE_NAMES];

const registerInput: RegisterKYCInput = {
  subjectId: SUBJECT,
  merkleRoot: merkleRootHex(demoAttributes()),
  attributeSetId: ATTRIBUTE_SET_ID,
  assuranceLevel: 'A2',
  methods: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS'],
  expiresAt: '2027-08-17T10:00:00Z',
  cnicExpiryAt: '2031-04-11T00:00:00Z',
  vaultRef: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  pepperEpoch: 1,
  originProduct: 'WALLET',
};

// ===========================================================================
describe('SEC-11 · deterministic event IDs across endorsing peers', () => {
  test('two peers executing the same transaction produce identical event keys', async () => {
    // Peer A has already served many transactions; peer B was just restarted.
    // A module-level counter would diverge here — that was the bug.
    const peerA = new MemoryStateStore();
    const peerB = new MemoryStateStore();

    // Warm peer A with unrelated prior transactions.
    for (let i = 0; i < 17; i++) {
      await registerKYC(peerA, memoryContext({ txId: `warmup-${i}` }), {
        ...registerInput,
        subjectId: String(i).padStart(64, 'b'),
      });
    }

    const txId = 'tx-deterministic-001';
    await registerKYC(peerA, memoryContext({ txId }), registerInput);
    await registerKYC(peerB, memoryContext({ txId }), registerInput);

    const keysA = Object.keys(peerA.snapshot()).filter((k) => k.startsWith(`AEVT~${SUBJECT}`));
    const keysB = Object.keys(peerB.snapshot()).filter((k) => k.startsWith(`AEVT~${SUBJECT}`));

    assert.deepEqual(keysA, keysB, 'audit event keys must be identical across peers');
    assert.equal(keysA.length, 1);
    assert.match(keysA[0]!, /aevt-tx-deterministic-001-0001$/);
  });

  test('ordinals restart at 1 for each transaction', async () => {
    const store = new MemoryStateStore();
    await registerKYC(store, memoryContext({ txId: 'tx-A' }), registerInput);
    await registerKYC(store, memoryContext({ txId: 'tx-B' }), {
      ...registerInput,
      subjectId: 'c'.repeat(64),
    });

    const ids = Object.keys(store.snapshot()).filter((k) => k.startsWith('AEVT~'));
    assert.ok(ids.some((k) => k.endsWith('aevt-tx-A-0001')));
    assert.ok(ids.some((k) => k.endsWith('aevt-tx-B-0001')));
  });

  test('multiple events in one transaction get increasing ordinals', () => {
    const ctx = memoryContext({ txId: 'tx-multi' });
    assert.equal(ctx.nextOrdinal(), 1);
    assert.equal(ctx.nextOrdinal(), 2);
    assert.equal(ctx.nextOrdinal(), 3);
  });
});

// ===========================================================================
describe('SEC-04 · PII exemption is granted by field name, not by pattern', () => {
  test('a CNIC hidden in an unvalidated hash-like field is CAUGHT', () => {
    // 64 hex characters containing a 13-digit run. Under the old textual rule
    // this was stripped wholesale and the CNIC slipped through.
    const disguised = '6110112345678' + 'a'.repeat(51);
    assert.equal(disguised.length, 64);

    assert.throws(
      () => assertNoPII({ providerRef: disguised }),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_PII_DETECTED',
      'a CNIC inside a non-hex-typed field must be detected',
    );
  });

  test('the same value in a NAMED, validated hex field is exempt', () => {
    const looksLikeCnic = '6110112345678' + 'a'.repeat(51);
    assert.doesNotThrow(() => assertNoPII({ subjectId: looksLikeCnic }));
    assert.doesNotThrow(() => assertNoPII({ merkleRoot: looksLikeCnic }));
  });

  test('exemption does not apply when the value is not really 64 hex', () => {
    assert.throws(
      () => assertNoPII({ subjectId: '6110112345678' }),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_PII_DETECTED',
    );
  });

  test('nested and array positions are scanned', () => {
    assert.throws(() => assertNoPII({ a: { b: { c: ['6110112345678'] } } }), KycError);
    assert.throws(() => assertNoPII({ list: [{ note: 'x6110112345678' }] }), KycError);
  });

  test('object KEYS are scanned too', () => {
    assert.throws(() => assertNoPII({ '6110112345678': 'value' }), KycError);
  });

  test('composite state keys embedding a subjectId do not false-positive', () => {
    const key = `KYC~${'1234567890123456'.repeat(4)}~0000000001`;
    assert.doesNotThrow(() => assertNoPII({ [key]: { version: 1 } }));
  });

  test('a serialised string payload is parsed and walked structurally', () => {
    assert.throws(() => assertNoPII(JSON.stringify({ note: '6110112345678' })), KycError);
    assert.doesNotThrow(() => assertNoPII(JSON.stringify({ subjectId: 'a'.repeat(64) })));
  });

  /**
   * Only the OUTERMOST string is parsed. A string nested inside the payload is
   * scanned as raw text, so no field-name exemption can be claimed at that
   * depth — which is what stops SEC-04 returning one serialisation deeper.
   *
   * Do not "fix" this by making walk() parse nested strings. Two holes open:
   *   1. JSON.parse('6110112345678') yields the NUMBER 6110112345678, and
   *      walk() returns on numbers without scanning — a bare CNIC in any
   *      string field would stop being detected outright.
   *   2. A serialised { subjectId: <64 hex containing a CNIC> } would parse
   *      into an exempt named field, which is precisely SEC-04.
   *
   * The cost of keeping it: a caller that passes doubly-serialised JSON gets
   * false positives on hex64 identifiers. Callers pass parsed structures
   * instead — see assertNoPII's contract in packages/types/src/index.ts.
   */
  test('a CNIC nested inside a serialised string is still caught', () => {
    const cnic = '6110112345678';
    const disguised = cnic + 'a'.repeat(51); // 64 hex chars hiding a CNIC

    // Bare CNIC inside a serialised record, under an exempt field name.
    assert.throws(
      () => assertNoPII({ record: JSON.stringify({ subjectId: cnic }) }),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_PII_DETECTED',
      'a CNIC in a nested serialised record must be detected',
    );

    // The SEC-04 disguise, one serialisation deeper: still caught, because the
    // exemption is never granted to text.
    assert.throws(
      () => assertNoPII({ record: JSON.stringify({ subjectId: disguised }) }),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_PII_DETECTED',
      'the SEC-04 disguise must not survive being serialised',
    );

    // And the shape the state-export test actually produces: an outer
    // serialised map whose values are themselves serialised records.
    const key = `SUBJ~${'a'.repeat(64)}`;
    assert.throws(
      () => assertNoPII(JSON.stringify({ [key]: JSON.stringify({ note: cnic }) })),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_PII_DETECTED',
      'a CNIC in a doubly-serialised state export must be detected',
    );
  });

  test('scanTextForPII remains available for freeform text, and is weaker', () => {
    assert.equal(scanTextForPII('customer 6110112345678 called'), true);
    assert.equal(scanTextForPII(`hash ${'a'.repeat(64)}`), false);
  });
});

// ===========================================================================
describe('SEC-10 · consent scope validated against the policy ceiling at grant time', () => {
  const base = {
    consentId: 'c1',
    subjectId: SUBJECT,
    grantedTo: 'ABHILendingMSP',
    purpose: 'EWA_ORIGINATION',
    expiresAt: '2027-01-01T00:00:00Z',
    evidenceRef: 'tc-001',
  };

  test('a consent broader than any policy could honour is REJECTED at grant time', async () => {
    const store = new MemoryStateStore();
    await registerKYC(store, memoryContext(), registerInput);

    // `profession` is in the attribute set but no product policy discloses it.
    await assert.rejects(
      () =>
        recordConsent(
          store,
          memoryContext(),
          { ...base, scope: ['verisys_match', 'profession'] },
          KNOWN,
          MAX_DISCLOSABLE_ATTRIBUTES,
        ),
      (e: unknown) =>
        e instanceof KycError &&
        e.code === 'ERR_INVALID_SCOPE' &&
        (e.detail ?? '').includes('profession'),
    );
  });

  test('a consent within the ceiling is accepted', async () => {
    const store = new MemoryStateStore();
    await registerKYC(store, memoryContext(), registerInput);
    const r = await recordConsent(
      store,
      memoryContext(),
      { ...base, scope: ['verisys_match', 'biometric_match'] },
      KNOWN,
      MAX_DISCLOSABLE_ATTRIBUTES,
    );
    assert.equal(r.consentId, 'c1');
  });

  test('the ceiling is the union of all product policies', () => {
    assert.ok(MAX_DISCLOSABLE_ATTRIBUTES.includes('verisys_match'));
    assert.ok(MAX_DISCLOSABLE_ATTRIBUTES.includes('liveness_pass'));
    assert.ok(MAX_DISCLOSABLE_ATTRIBUTES.includes('date_of_birth'));
    // Never disclosed by any policy.
    assert.equal(MAX_DISCLOSABLE_ATTRIBUTES.includes('profession'), false);
    assert.equal(MAX_DISCLOSABLE_ATTRIBUTES.includes('address_hash'), false);
    assert.equal(MAX_DISCLOSABLE_ATTRIBUTES.includes('source_of_funds'), false);
  });

  test('the gateway applies the ceiling end to end', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    await assert.rejects(
      () =>
        h.svc.grantConsent(
          h.bank(),
          CNIC_WALLET,
          'ABHILendingMSP',
          'EWA_ORIGINATION',
          ['verisys_match', 'source_of_funds'],
          '2027-01-01T00:00:00Z',
          'tc-x',
        ),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_INVALID_SCOPE',
    );
  });

  test('over-disclosure remains impossible even without a ceiling', async () => {
    // Defence in depth: the grant-time check is about audit clarity. The
    // three-way intersection at proof time is what actually prevents release.
    const store = new MemoryStateStore();
    await registerKYC(store, memoryContext(), registerInput);
    await recordConsent(
      store,
      memoryContext(),
      { ...base, scope: ['verisys_match', 'profession'] },
      KNOWN,
      // no ceiling supplied
    );
    const audit = await getAuditTrail(store, memoryContext(), SUBJECT);
    const grant = audit.find((e) => e.action === 'CONSENT_GRANT');
    assert.deepEqual(grant?.attributesDisclosed, ['profession', 'verisys_match']);
  });
});

// ===========================================================================
describe('SEC-15 · log redaction covers the CNIC format that actually arrives', () => {
  /*
   * The redactor matched `\d{13,}` only, so `6110112345678` was masked and
   * `61101-1234567-8` sailed through. The dashed form is the one Pakistani
   * systems use, and the one ABHI's own CNIC entry screen specifies — and two
   * live GET endpoints take the CNIC in
   * a query string that the request logger writes out verbatim as `path`.
   *
   * No coding mistake was needed to reach this. One customer lookup wrote a
   * citizen's primary identifier to stdout.
   */
  test('dashed and spaced CNICs are redacted', () => {
    for (const raw of ['61101-1234567-8', '35202-1234567-1', '61101 1234567 8']) {
      assert.equal(scrubString(raw), '[REDACTED-ID]', `${raw} must not survive redaction`);
    }
  });

  test('a dashed CNIC in a request path is redacted', () => {
    // This is the exact shape the request logger emits for GET /kyc/history.
    const logged = redact({ level: 'info', path: '/kyc/history?cnic=61101-1234567-8' }) as {
      path: string;
    };
    assert.equal(logged.path, '/kyc/history?cnic=[REDACTED-ID]');
    assert.ok(!scanTextForPII(logged.path.replace(/-/g, '')));
  });

  test('undashed CNICs are still redacted', () => {
    assert.equal(scrubString('6110112345678'), '[REDACTED-ID]');
    assert.equal(
      (redact({ path: '/audit/events?cnic=6110112345678' }) as { path: string }).path,
      '/audit/events?cnic=[REDACTED-ID]',
    );
  });

  /*
   * The other half of the fix. Lifting hex identifiers out of the scrub is
   * what lets the digit-run rule stay aggressive without mangling the values
   * operators actually correlate logs by.
   */
  test('subject IDs survive redaction, including inside a path', () => {
    const subjectId = 'a1b2c3d4'.repeat(8);
    assert.equal(scrubString(subjectId), subjectId);
    assert.equal(
      scrubString(`/customers/${subjectId}/history`),
      `/customers/${subjectId}/history`,
    );

    // A 64-hex subjectId containing a 13-digit run must not be mangled.
    const digity = `1234567890123${'abcdef'.repeat(9)}abcdefghi`.slice(0, 64);
    const hex = digity.replace(/[g-z]/g, '0');
    assert.equal(scrubString(`/customers/${hex}/history`), `/customers/${hex}/history`);
  });

  test('ordinary log text is left alone', () => {
    for (const benign of [
      'in 5 minutes the job ran for 12 seconds',
      '2026-08-23T15:23:04Z',
      'PKR 1,204,000 spent',
      'cohort seeded: 1204 records',
    ]) {
      assert.equal(scrubString(benign), benign, `${benign} should not be redacted`);
    }
  });

  test('key-based denial still applies on top of value scrubbing', () => {
    const out = redact({ cnic: '61101-1234567-8', note: 'ok' }) as Record<string, unknown>;
    assert.equal(out['cnic'], '[REDACTED]');
    assert.equal(out['note'], 'ok');
  });
});
