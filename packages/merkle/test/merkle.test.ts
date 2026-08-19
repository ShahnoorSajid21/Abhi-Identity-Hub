// FICTIONAL-CNIC-OK: fictional CNICs exercising normalisation and the reject rules. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalValue } from '@abhi/canonical';
import {
  leafHash,
  nodeHash,
  buildLeaves,
  buildLevels,
  buildRoot,
  buildPath,
  verifyAttributeProof,
  verifyProofBundle,
  generateProofBundle,
  demoAttributes,
  demoSalt,
  newSalt,
  normaliseCnic,
  ATTRIBUTE_SET_ID,
  ATTRIBUTE_NAMES,
  type Attribute,
} from '../src/index.ts';

describe('domain separation', () => {
  test('leaf and node prefixes differ, defeating second-preimage substitution', () => {
    const salt = demoSalt('x');
    const leaf = leafHash(salt, 'x', 's:v');
    const asNode = nodeHash(leaf, leaf);
    assert.notEqual(leaf.toString('hex'), asNode.toString('hex'));

    // An internal node must not be reconstructible as a leaf hash.
    const forged = createHash('sha256')
      .update(Buffer.from([0x00]))
      .update(leaf)
      .update(leaf)
      .digest();
    assert.notEqual(asNode.toString('hex'), forged.toString('hex'));
  });

  test('type tags prevent string/boolean leaf collision', () => {
    const salt = demoSalt('flag');
    const asBool = leafHash(salt, 'flag', canonicalValue(true));
    const asString = leafHash(salt, 'flag', canonicalValue('true'));
    assert.notEqual(asBool.toString('hex'), asString.toString('hex'));
  });
});

describe('tree construction', () => {
  test('root is order-independent — leaves sort by attribute name', () => {
    const attrs = demoAttributes();
    const shuffled = [...attrs].reverse();
    assert.equal(buildRoot(buildLeaves(attrs).leaves).toString('hex'), buildRoot(buildLeaves(shuffled).leaves).toString('hex'));
  });

  test('odd nodes are promoted, not duplicated', () => {
    const mk = (n: number): Buffer[] =>
      Array.from({ length: n }, (_, i) => leafHash(demoSalt(`a${i}`), `a${i}`, `s:${i}`));

    const three = mk(3);
    const levels = buildLevels(three);
    // level 1 = [ H(l0,l1), l2 ] — the third leaf carried up unchanged.
    assert.equal(levels[1]!.length, 2);
    assert.equal(levels[1]![1]!.toString('hex'), three[2]!.toString('hex'));

    // The duplicate-last-node construction must produce a different root.
    const duplicated = nodeHash(nodeHash(three[0]!, three[1]!), nodeHash(three[2]!, three[2]!));
    assert.notEqual(buildRoot(three).toString('hex'), duplicated.toString('hex'));
  });

  test('rejects duplicate attribute names', () => {
    const salt = newSalt();
    const dupes: Attribute[] = [
      { name: 'a', value: '1', salt },
      { name: 'a', value: '2', salt },
    ];
    assert.throws(() => buildLeaves(dupes), /duplicate attribute/);
  });

  test('rejects an empty attribute set', () => {
    assert.throws(() => buildLeaves([]), /empty attribute set/);
  });
});

describe('selective disclosure', () => {
  test('every single attribute proves against the root', () => {
    const attrs = demoAttributes();
    const root = buildRoot(buildLeaves(attrs).leaves).toString('hex');
    for (const name of ATTRIBUTE_NAMES) {
      const bundle = generateProofBundle(attrs, [name], ATTRIBUTE_SET_ID);
      assert.equal(bundle.merkleRoot, root, `root mismatch for ${name}`);
      assert.ok(verifyProofBundle(bundle), `proof failed for ${name}`);
    }
  });

  test('a tampered canonical value fails verification', () => {
    const attrs = demoAttributes();
    const bundle = generateProofBundle(attrs, ['verisys_match'], ATTRIBUTE_SET_ID);
    const tampered = { ...bundle.attributes[0]!, canonical: 'b:0' };
    assert.equal(verifyAttributeProof(tampered, bundle.merkleRoot), false);
  });

  test('a tampered path step fails verification', () => {
    const attrs = demoAttributes();
    const bundle = generateProofBundle(attrs, ['fatca_status'], ATTRIBUTE_SET_ID);
    const proof = bundle.attributes[0]!;
    const broken = {
      ...proof,
      path: proof.path.map((s, i) => (i === 0 ? { ...s, hash: 'ff'.repeat(32) } : s)),
    };
    assert.equal(verifyAttributeProof(broken, bundle.merkleRoot), false);
  });

  test('a proof from a different attribute set fails against this root', () => {
    const a = demoAttributes();
    const b = demoAttributes().map((x) => ({ ...x, salt: newSalt() }));
    const bundleA = generateProofBundle(a, ['verisys_match'], ATTRIBUTE_SET_ID);
    const bundleB = generateProofBundle(b, ['verisys_match'], ATTRIBUTE_SET_ID);
    assert.equal(verifyAttributeProof(bundleB.attributes[0]!, bundleA.merkleRoot), false);
  });

  test('withheld values are mechanically absent from the serialised bundle', () => {
    const attrs = demoAttributes();
    const bundle = generateProofBundle(
      attrs,
      ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
      ATTRIBUTE_SET_ID,
    );
    const serialised = JSON.stringify(bundle);
    for (const withheld of [
      'Machine Operator',
      'Salary disbursement',
      '1994-02-17',
      '486ea46224d1bb4f',
      '9f86d081884c7d65',
      '2c26b46b68ffc68f',
    ]) {
      assert.equal(serialised.includes(withheld), false, `${withheld} leaked into the bundle`);
    }
  });

  test('rejects a request for an attribute outside the set', () => {
    assert.throws(
      () => generateProofBundle(demoAttributes(), ['not_an_attribute'], ATTRIBUTE_SET_ID),
      /attribute not in set/,
    );
  });
});

describe('property-based: proof verifies iff attribute is in the set', () => {
  test('2000 random attribute sets of varying size', () => {
    for (let iter = 0; iter < 2000; iter++) {
      const size = 1 + Math.floor(Math.random() * 20);
      const attrs: Attribute[] = Array.from({ length: size }, (_, i) => ({
        name: `attr_${String(i).padStart(3, '0')}`,
        value: Math.random() < 0.5 ? randomBytes(4).toString('hex') : Math.random() < 0.5,
        salt: newSalt(),
      }));

      const target = attrs[Math.floor(Math.random() * size)]!;
      const bundle = generateProofBundle(attrs, [target.name], ATTRIBUTE_SET_ID);
      assert.ok(verifyProofBundle(bundle), `size=${size} failed for ${target.name}`);

      // Same proof against a root built from a different set must fail.
      const otherRoot = buildRoot(
        buildLeaves(attrs.map((a) => ({ ...a, salt: newSalt() }))).leaves,
      ).toString('hex');
      assert.equal(verifyAttributeProof(bundle.attributes[0]!, otherRoot), false);
    }
  });

  test('path length is ceil(log2(n)) or one less, for all sizes 1..64', () => {
    for (let n = 1; n <= 64; n++) {
      const attrs: Attribute[] = Array.from({ length: n }, (_, i) => ({
        name: `a_${String(i).padStart(3, '0')}`,
        value: `s:${i}`,
        salt: demoSalt(`a_${i}`),
      }));
      const { leaves } = buildLeaves(attrs);
      const levels = buildLevels(leaves);
      const expectedDepth = Math.ceil(Math.log2(Math.max(n, 1)));
      assert.equal(levels.length - 1, expectedDepth, `depth wrong for n=${n}`);

      for (let i = 0; i < n; i++) {
        assert.ok(buildPath(levels, i).length <= expectedDepth);
      }
    }
  });
});

describe('CNIC normalisation', () => {
  test('formatted and unformatted CNICs resolve identically', () => {
    assert.equal(normaliseCnic('61101-1234567-8'), '6110112345678');
    assert.equal(normaliseCnic('6110112345678'), '6110112345678');
    assert.equal(normaliseCnic(' 61101 1234567 8 '), '6110112345678');
  });

  test('fails closed on wrong length — never pads or truncates', () => {
    assert.throws(() => normaliseCnic('611011234567'), /13 digits/);
    assert.throws(() => normaliseCnic('61101123456789'), /13 digits/);
    assert.throws(() => normaliseCnic(''), /13 digits/);
  });

  test('rejects obvious test values', () => {
    assert.throws(() => normaliseCnic('0000000000000'), /repeated-digit/);
    assert.throws(() => normaliseCnic('1111111111111'), /repeated-digit/);
  });
});
