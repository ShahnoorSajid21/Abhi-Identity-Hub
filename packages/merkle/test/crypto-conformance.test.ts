// FICTIONAL-CNIC-OK: fictional CNICs pinning the subject-id derivation rule. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalValue } from '@abhi/canonical';
import {
  SALT_BYTES,
  LEAF_PREFIX,
  NODE_PREFIX,
  newSalt,
  leafHash,
  nodeHash,
  sha256Hex,
  hmacSha256Hex,
  buildLeaves,
  normaliseCnic,
  deriveSubjectId,
  SoftwarePepperProvider,
  demoAttributes,
  demoSalt,
  ATTRIBUTE_NAMES,
} from '../src/index.ts';

/**
 * Cryptographic conformance audit.
 *
 * The constructions these tests pin are already correct in `src/`. What was
 * missing was an executable statement of the RULE, as distinct from a test of
 * the behaviour: nothing previously failed if `deriveSubjectId` were quietly
 * changed to a plain SHA-256, or if the salt-length guard were dropped. A
 * reviewer had to read the source and take it on trust.
 *
 * Each test below therefore recomputes the required construction independently
 * from the specification and asserts equality, and — where a weaker
 * construction would still "work" — asserts inequality against that weaker
 * form too. That second half is the part that actually catches a regression.
 */

const PEPPER = randomBytes(32);
const CNIC_FORMATTED = '61101-1234567-8';
const CNIC_BARE = '6110112345678';

// ===========================================================================
describe('AUDIT-1 · subject_id = HMAC-SHA256(pepper, normalise(CNIC))', () => {
  test('matches the specified HMAC construction exactly', async () => {
    const p = new SoftwarePepperProvider(PEPPER);
    const subjectId = await deriveSubjectId(CNIC_FORMATTED, p);

    const expected = hmacSha256Hex(PEPPER, Buffer.from(normaliseCnic(CNIC_FORMATTED), 'utf8'));
    assert.equal(subjectId, expected);
    assert.match(subjectId, /^[0-9a-f]{64}$/);
  });

  test('is NOT a plain hash — every unkeyed variant is rejected', async () => {
    const p = new SoftwarePepperProvider(PEPPER);
    const subjectId = await deriveSubjectId(CNIC_FORMATTED, p);
    const norm = normaliseCnic(CNIC_FORMATTED);

    // A 13-digit CNIC is ~10^13 values. Every construction below is
    // exhaustible on a commodity GPU, so any of them would make the on-chain
    // identifier trivially reversible to a real citizen. This is the single
    // most consequential line in the whole cryptographic design.
    assert.notEqual(subjectId, sha256Hex(norm), 'subjectId must not be SHA-256(cnic)');
    assert.notEqual(subjectId, sha256Hex(CNIC_FORMATTED), 'must not be SHA-256(raw cnic)');
    assert.notEqual(
      subjectId,
      sha256Hex(Buffer.concat([PEPPER, Buffer.from(norm, 'utf8')])),
      'must not be a prefix-keyed hash — that construction is length-extendable',
    );
    assert.notEqual(
      subjectId,
      sha256Hex(Buffer.concat([Buffer.from(norm, 'utf8'), PEPPER])),
      'must not be a suffix-keyed hash',
    );
  });

  test('is key-dependent — a different pepper gives a different subject', async () => {
    // The property a plain hash cannot have, stated directly: without this,
    // two ABHI deployments (or a leaked lookup table) correlate to the same
    // person.
    const a = await deriveSubjectId(CNIC_FORMATTED, new SoftwarePepperProvider(PEPPER));
    const b = await deriveSubjectId(CNIC_FORMATTED, new SoftwarePepperProvider(randomBytes(32)));
    assert.notEqual(a, b);
  });

  test('normalisation is applied before the HMAC, not after', async () => {
    const p = new SoftwarePepperProvider(PEPPER);
    // Employer CSV strips dashes; the app captures them. Both must resolve to
    // one subject or the reuse premise fails silently.
    assert.equal(await deriveSubjectId(CNIC_FORMATTED, p), await deriveSubjectId(CNIC_BARE, p));
    // And the HMAC is over the normalised digits, never the raw input.
    assert.notEqual(
      await deriveSubjectId(CNIC_FORMATTED, p),
      hmacSha256Hex(PEPPER, Buffer.from(CNIC_FORMATTED, 'utf8')),
    );
  });

  test('a pepper shorter than 32 bytes is refused', () => {
    assert.throws(() => new SoftwarePepperProvider(randomBytes(31)), /at least 32 bytes/);
  });
});

// ===========================================================================
describe('AUDIT-2 · 14-leaf attribute commitment', () => {
  test('the attribute set is exactly 14 leaves, and the tree commits to all of them', () => {
    assert.equal(ATTRIBUTE_NAMES.length, 14);
    assert.equal(new Set(ATTRIBUTE_NAMES).size, 14, 'attribute names must be unique');
    assert.equal(buildLeaves(demoAttributes()).leaves.length, 14);
  });

  test('domain separation: leaves are 0x00-prefixed, nodes are 0x01-prefixed', () => {
    assert.deepEqual(LEAF_PREFIX, Buffer.from([0x00]));
    assert.deepEqual(NODE_PREFIX, Buffer.from([0x01]));

    const salt = demoSalt('profession');
    const canonical = canonicalValue('Machine Operator');

    // Recompute both constructions from the specification, independently.
    const specLeaf = createHash('sha256')
      .update(Buffer.from([0x00]))
      .update(salt)
      .update(Buffer.from([0x00]))
      .update(Buffer.from('profession', 'utf8'))
      .update(Buffer.from([0x00]))
      .update(Buffer.from(canonical, 'utf8'))
      .digest();
    assert.equal(leafHash(salt, 'profession', canonical).toString('hex'), specLeaf.toString('hex'));

    const l = leafHash(demoSalt('a'), 'a', 's:1');
    const r = leafHash(demoSalt('b'), 'b', 's:2');
    const specNode = createHash('sha256')
      .update(Buffer.from([0x01]))
      .update(l)
      .update(r)
      .digest();
    assert.equal(nodeHash(l, r).toString('hex'), specNode.toString('hex'));

    // Without the differing prefixes an internal node could be presented as a
    // leaf — the classic Merkle second-preimage substitution.
    assert.notEqual(LEAF_PREFIX[0], NODE_PREFIX[0]);
  });

  test('salts are exactly 32 bytes, and a wrong length is refused', () => {
    assert.equal(SALT_BYTES, 32);
    assert.equal(newSalt().length, 32);

    for (const bad of [0, 16, 31, 33, 64]) {
      assert.throws(
        () => leafHash(randomBytes(bad), 'profession', 's:x'),
        /salt must be 32 bytes/,
        `a ${bad}-byte salt must be refused`,
      );
    }
  });

  test('every one of the 14 attributes carries its own distinct 32-byte salt', () => {
    const attrs = demoAttributes();
    assert.equal(attrs.length, 14);
    for (const a of attrs) assert.equal(a.salt.length, SALT_BYTES);
    assert.equal(new Set(attrs.map((a) => a.salt.toString('hex'))).size, 14);
  });

  test('per-attribute salting hides low-entropy values', () => {
    // fatca_status has two possible values across the entire bank. Unsalted,
    // its leaf is byte-identical for every customer holding that value and is
    // instantly recognisable on a shared ledger.
    assert.notEqual(
      leafHash(demoSalt('fatca_status'), 'fatca_status', canonicalValue(false)).toString('hex'),
      leafHash(newSalt(), 'fatca_status', canonicalValue(false)).toString('hex'),
    );
  });

  test('leaves are sorted by attribute name, independent of input order', () => {
    const attrs = demoAttributes();
    const expected = [...ATTRIBUTE_NAMES].sort();

    for (const order of [attrs, [...attrs].reverse(), [...attrs].sort(() => Math.random() - 0.5)]) {
      const { names } = buildLeaves(order);
      assert.deepEqual(names, expected, 'buildLeaves must emit names in sorted order');
    }
  });

  test('leaf i is the hash of sorted-attribute i — position is not incidental', () => {
    const attrs = demoAttributes();
    const { names, leaves } = buildLeaves([...attrs].reverse());
    const byName = new Map(attrs.map((a) => [a.name, a]));

    names.forEach((name, i) => {
      const a = byName.get(name)!;
      assert.equal(
        leaves[i]!.toString('hex'),
        leafHash(a.salt, name, canonicalValue(a.value)).toString('hex'),
      );
    });
  });
});
