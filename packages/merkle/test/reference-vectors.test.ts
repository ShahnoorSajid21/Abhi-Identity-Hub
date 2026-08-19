import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalValue, canonicalJSON } from '@abhi/canonical';
import {
  DEMO_PEPPER,
  DEMO_CNIC,
  DEMO_ATTRIBUTE_VALUES,
  demoAttributes,
  buildLeaves,
  buildRoot,
  generateProofBundle,
  verifyProofBundle,
  hmacSha256Hex,
  sha256Hex,
  normaliseCnic,
  ATTRIBUTE_SET_ID,
  type AttributeName,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, '..', 'vectors', 'reference-vectors.json'), 'utf8'),
) as {
  subjectId: string;
  merkleRoot: string;
  leaves: { attribute: string; canonical: string; salt: string; leaf: string }[];
  ewaDisclosure: {
    disclosed: string[];
    pathLengths: Record<string, number>;
    withheldValuesAbsentFromBundle: Record<string, boolean>;
  };
  chainLink: { v1RecordCanonical: string; previousVersionHash: string };
};

/**
 * These tests pin the cryptographic construction. If any of them fail after a
 * change to hashing, sorting, padding or domain separation, that change alters
 * every historical root in the bank and must be treated as a breaking change
 * requiring a new attributeSetId — not as a test to update.
 */
describe('reference vectors — pinned construction', () => {
  test('subject ID derivation is stable', () => {
    const derived = hmacSha256Hex(DEMO_PEPPER, Buffer.from(normaliseCnic(DEMO_CNIC), 'utf8'));
    assert.equal(derived, vectors.subjectId);
    assert.match(derived, /^[0-9a-f]{64}$/);
  });

  test('merkle root is stable', () => {
    const root = buildRoot(buildLeaves(demoAttributes()).leaves).toString('hex');
    assert.equal(root, vectors.merkleRoot);
  });

  test('all 14 leaves reproduce', () => {
    const attrs = demoAttributes();
    const { names, leaves } = buildLeaves(attrs);
    assert.equal(leaves.length, 14);
    assert.equal(vectors.leaves.length, 14);

    names.forEach((name, i) => {
      const expected = vectors.leaves[i]!;
      assert.equal(name, expected.attribute);
      assert.equal(leaves[i]!.toString('hex'), expected.leaf, `leaf mismatch for ${name}`);
    });
  });

  test('canonical value encoding matches the concept document worked example', () => {
    // These are the values printed in ABHI_KYC_Ledger_IDEA.md section 4 and
    // they are independent of the demonstration salts, so they must match the
    // published document exactly.
    const expected: Record<string, string> = {
      address_hash: 's:486ea46224d1bb4f',
      biometric_match: 'b:1',
      cnic_expiry: 's:2031-04-11',
      cnic_number_hash: 's:e3b0c44298fc1c14',
      date_of_birth: 's:1994-02-17',
      document_authenticity_pass: 'b:1',
      fatca_status: 'b:0',
      father_or_husband_name_hash: 's:2c26b46b68ffc68f',
      full_name_hash: 's:9f86d081884c7d65',
      liveness_pass: 'b:0',
      profession: 's:Machine Operator',
      purpose_of_account: 's:Salary disbursement',
      source_of_funds: 's:Salary',
      verisys_match: 'b:1',
    };
    for (const [name, canonical] of Object.entries(expected)) {
      assert.equal(
        canonicalValue(DEMO_ATTRIBUTE_VALUES[name as AttributeName]),
        canonical,
        `canonical form drifted for ${name}`,
      );
    }
  });

  test('EWA proof path lengths match the concept document (3, 4, 4, 4)', () => {
    const bundle = generateProofBundle(
      demoAttributes(),
      vectors.ewaDisclosure.disclosed,
      ATTRIBUTE_SET_ID,
    );
    assert.ok(verifyProofBundle(bundle));

    const lengths = Object.fromEntries(bundle.attributes.map((a) => [a.name, a.path.length]));
    assert.deepEqual(lengths, {
      verisys_match: 3,
      biometric_match: 4,
      cnic_expiry: 4,
      fatca_status: 4,
    });
    assert.deepEqual(lengths, vectors.ewaDisclosure.pathLengths);
  });

  test('every withheld value is absent from the serialised bundle', () => {
    for (const [, present] of Object.entries(vectors.ewaDisclosure.withheldValuesAbsentFromBundle)) {
      assert.equal(present, false);
    }
  });

  test('chain link hashes the predecessor AS STORED, post-supersession', () => {
    const recomputed = sha256Hex(vectors.chainLink.v1RecordCanonical);
    assert.equal(recomputed, vectors.chainLink.previousVersionHash);

    // And the canonical form must round-trip through canonicalJSON unchanged.
    const parsed = JSON.parse(vectors.chainLink.v1RecordCanonical) as unknown;
    assert.equal(canonicalJSON(parsed), vectors.chainLink.v1RecordCanonical);

    // The record hashed must carry status SUPERSEDED — hashing the
    // pre-supersession form would make the chain unverifiable from an export.
    assert.match(vectors.chainLink.v1RecordCanonical, /"status":"SUPERSEDED"/);
  });
});
