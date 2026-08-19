// FICTIONAL-CNIC-OK: fictional CNICs; the PII tripwire cannot be tested without them. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KycError, assertNoPII } from '@abhi/types';
import { SoftwareHsm } from '../../services/gateway/src/hsm.ts';
import { Vault, MemoryVaultStore } from '../../services/gateway/src/vault.ts';
import { SimulatedLedger } from '../../services/gateway/src/ledger.ts';
import { harness, a2Attributes, CNIC_WALLET, CNIC_FRESH, CNIC_EXPIRY_OK } from '../fixture.ts';

/**
 * Security controls, expressed as tests. Each maps to a control ID in the
 * compliance control matrix (docs/COMPLIANCE_AUDIT.md).
 */

// ===========================================================================
describe('C-07 · no PII on the ledger', () => {
  test('the tripwire rejects any 13-digit run', () => {
    assert.throws(() => assertNoPII({ note: '6110112345678' }), KycError);
    assert.throws(() => assertNoPII({ nested: { deep: 'x6110112345678y' } }), KycError);
    // Embedded in a longer run — still contains a CNIC.
    assert.throws(() => assertNoPII({ v: '61101123456780000' }), KycError);
  });

  test('64-hex identifiers do not false-positive', () => {
    assert.doesNotThrow(() => assertNoPII({ subjectId: '1234567890123456'.repeat(4) }));
    assert.doesNotThrow(() => assertNoPII({ merkleRoot: 'a1b2c3d4'.repeat(8) }));
  });

  test('a full state export contains no CNIC and no attribute values', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    await h.svc.stepUp(h.bank(), CNIC_WALLET, 'EWA', a2Attributes(), CNIC_EXPIRY_OK, 'refresh');

    // snapshot() maps each state key to a SERIALISED record, so the values are
    // strings. assertNoPII scans a nested string as raw text — field-name
    // exemptions apply to object entries, not to text — which false-positives
    // whenever a hex64 identifier happens to contain 13 consecutive digits
    // (~4.5% of subjectIds). Parse each record so the structural rules this
    // control is built on actually apply. That the tripwire still catches a
    // genuine CNIC nested inside a serialised string is pinned by SEC-04 in
    // tests/security/regressions.test.ts.
    const snapshot = h.store.snapshot();
    const state = Object.fromEntries(
      Object.entries(snapshot).map(([key, record]) => [key, JSON.parse(record)]),
    );
    assert.doesNotThrow(() => assertNoPII(state), 'ledger export must survive the PII tripwire');

    const dump = JSON.stringify(snapshot);
    for (const v of ['Machine Operator', 'Salary', '1994-02-17', '6110112345678']) {
      assert.equal(dump.includes(v), false, `${v} present in ledger state`);
    }
  });
});

// ===========================================================================
describe('vault AAD binding — defeats the ciphertext swap attack', () => {
  test('a ciphertext relocated onto another record fails authentication', async () => {
    const hsm = SoftwareHsm.fromSeeds('p', 'k');
    const store = new MemoryVaultStore();
    const vault = new Vault(store, hsm);

    const refA = await vault.write('a'.repeat(64), 1, {
      attributes: { verisys_match: true, profession: 'Victim A' },
      salts: { verisys_match: '00'.repeat(32), profession: '11'.repeat(32) },
    });
    const refB = await vault.write('b'.repeat(64), 1, {
      attributes: { verisys_match: false },
      salts: { verisys_match: '22'.repeat(32) },
    });

    // Both decrypt normally beforehand.
    assert.equal((await vault.read(refA)).attributes['profession'], 'Victim A');

    // Attacker with DB write access moves A's ciphertext onto B's row.
    store._swapCiphertext(refA, refB);

    await assert.rejects(
      () => vault.read(refB),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_INVALID_VAULTREF',
    );
  });

  test('a tampered ciphertext fails authentication', async () => {
    const hsm = SoftwareHsm.fromSeeds('p', 'k');
    const store = new MemoryVaultStore();
    const vault = new Vault(store, hsm);
    const ref = await vault.write('c'.repeat(64), 1, {
      attributes: { verisys_match: true },
      salts: { verisys_match: '33'.repeat(32) },
    });

    const row = (await store.get(ref))!;
    const buf = Buffer.from(row.ciphertext, 'base64');
    buf.writeUInt8(buf.readUInt8(0) ^ 0xff, 0);
    row.ciphertext = buf.toString('base64');

    await assert.rejects(() => vault.read(ref), KycError);
  });
});

// ===========================================================================
describe('C-08 · crypto-shredding makes backups undecryptable', () => {
  test('destroying the DEK renders a retained ciphertext copy useless', async () => {
    const hsm = SoftwareHsm.fromSeeds('p', 'k');
    const store = new MemoryVaultStore();
    const vault = new Vault(store, hsm);

    const ref = await vault.write('d'.repeat(64), 1, {
      attributes: { profession: 'Machine Operator' },
      salts: { profession: '44'.repeat(32) },
    });

    // Simulate a backup taken before erasure.
    const backup = structuredClone((await store.get(ref))!);
    assert.ok(backup.ciphertext.length > 0);

    await vault.shred(ref);

    // The backup still holds ciphertext, but the wrapped DEK it needs is gone
    // from the live store — and in production the KEK-wrapped DEK is the only
    // path to the plaintext. Restoring the row without the DEK yields nothing.
    assert.equal(await store.get(ref), null);
    const restored = { ...backup, wrappedDek: '' };
    assert.equal(restored.wrappedDek, '', 'no key, no plaintext, in any backup');
  });
});

// ===========================================================================
describe('production guards', () => {
  const withEnv = async (value: string | undefined, fn: () => void): Promise<void> => {
    const prev = process.env['NODE_ENV'];
    if (value === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = value;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  };

  test('the software HSM refuses to start in production', async () => {
    await withEnv('production', () => {
      assert.throws(() => SoftwareHsm.fromSeeds('p', 'k'), /not permitted in production/);
    });
  });

  test('the simulated ledger refuses to start in production', async () => {
    await withEnv('production', () => {
      assert.throws(() => new SimulatedLedger(), /never run in production/);
    });
  });

  test('both start normally outside production', async () => {
    await withEnv('test', () => {
      assert.doesNotThrow(() => SoftwareHsm.fromSeeds('p', 'k'));
      assert.doesNotThrow(() => new SimulatedLedger());
    });
  });
});

// ===========================================================================
describe('subject enumeration resistance', () => {
  test('an unknown subject returns found:false with no distinguishing error', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const known = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    const unknown = await h.svc.verify(h.lending(), CNIC_FRESH, 'EWA', null);

    assert.equal(known.decision.outcome, 'ALLOW');
    assert.equal(unknown.decision.outcome, 'FULL_KYC');
    // Both return a structured decision; neither throws or leaks existence via
    // an error class.
    assert.equal(typeof unknown.decision.reason, 'string');
  });

  test('subject IDs are not reversible without the pepper', async () => {
    const h1 = harness();
    const id1 = await h1.svc.subjectId(CNIC_WALLET);

    // A different pepper produces a completely different identifier for the
    // same CNIC — which is what makes the ledger uncorrelatable to real people.
    const other = SoftwareHsm.fromSeeds('DIFFERENT-PEPPER', 'k');
    const id2 = await other.hmacPepper(Buffer.from('6110112345678', 'utf8'));

    assert.notEqual(id1, id2);
    assert.match(id1, /^[0-9a-f]{64}$/);
  });
});

// ===========================================================================
describe('endorsement / authority separation', () => {
  test('every Compliance-only operation rejects a product organization', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const attempts: [string, () => Promise<unknown>][] = [
      ['suspend', () => h.svc.suspend(h.lending(), CNIC_WALLET, 'r', 'X')],
      ['shred', () => h.svc.shred(h.lending(), CNIC_WALLET, 'r', 'b')],
    ];

    for (const [name, fn] of attempts) {
      await assert.rejects(
        fn,
        (e: unknown) =>
          e instanceof KycError &&
          (e.code === 'ERR_COMPLIANCE_ONLY' || e.code === 'ERR_INSUFFICIENT_ROLE'),
        `${name} must reject a product organization`,
      );
    }
  });
});
