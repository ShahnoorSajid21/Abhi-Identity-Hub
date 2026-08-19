/**
 * Regenerates the canonical reference vectors for the ABHI KYC Ledger.
 *
 *   npm run vectors:generate
 *
 * Output is committed to packages/merkle/vectors/reference-vectors.json and
 * asserted by packages/merkle/test/reference-vectors.test.ts. If a change to
 * the hashing construction is ever made, this file changes and the diff is the
 * review artefact — which is the point.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalValue, canonicalJSON } from '@abhi/canonical';
import {
  DEMO_PEPPER,
  DEMO_CNIC,
  demoAttributes,
  demoSalt,
  ATTRIBUTE_SET_ID,
  ATTRIBUTE_NAMES,
  DEMO_ATTRIBUTE_VALUES,
  buildLeaves,
  buildRoot,
  generateProofBundle,
  hmacSha256Hex,
  sha256Hex,
  normaliseCnic,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'vectors');

const subjectId = hmacSha256Hex(DEMO_PEPPER, Buffer.from(normaliseCnic(DEMO_CNIC), 'utf8'));
const attrs = demoAttributes();
const { names, leaves } = buildLeaves(attrs);
const merkleRoot = buildRoot(leaves).toString('hex');

const leafTable = names.map((name, i) => ({
  attribute: name,
  canonical: canonicalValue(DEMO_ATTRIBUTE_VALUES[name as keyof typeof DEMO_ATTRIBUTE_VALUES]),
  salt: demoSalt(name).toString('hex'),
  leaf: leaves[i]!.toString('hex'),
}));

// What EWA actually receives: 4 of 14 attributes.
const EWA_DISCLOSURE = ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'];
const bundle = generateProofBundle(attrs, EWA_DISCLOSURE, ATTRIBUTE_SET_ID);

// The chain link: a v1 record marked SUPERSEDED and hashed AS STORED.
const v1Record = {
  docType: 'KYCRecord',
  subjectId,
  version: 1,
  previousVersionHash: null,
  merkleRoot,
  attributeSetId: ATTRIBUTE_SET_ID,
  assuranceLevel: 'A2',
  methods: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS'],
  verifiedBy: 'ABHIBankMSP',
  verifiedAt: '2026-03-11T09:14:22Z',
  expiresAt: '2027-03-11T09:14:22Z',
  cnicExpiryAt: '2031-04-11T00:00:00Z',
  status: 'SUPERSEDED',
  statusReason: null,
  vaultRef: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  pepperEpoch: 1,
  originProduct: 'WALLET',
  createdTxId: 'demo-tx-v1',
  schemaVersion: 1,
};
const previousVersionHash = sha256Hex(canonicalJSON(v1Record));

const withheld = ['Machine Operator', 'Salary disbursement', '1994-02-17', '486ea46224d1bb4f'];
const serialisedBundle = JSON.stringify(bundle);

const vectors = {
  _comment:
    'FICTIONAL-CNIC-OK: the CNIC below is invented. DEMONSTRATION VECTORS. Salts and pepper are derived deterministically from published seeds ' +
    '(ABHI-KYC-DEMO-PEPPER-v1 / ABHI-KYC-DEMO-SALT-v1) so this worked example is reproducible by ' +
    'any reviewer from the algorithm alone. NEVER use these constants outside a demo.',
  generatedBy: 'packages/merkle/scripts/generate-vectors.ts',
  attributeSetId: ATTRIBUTE_SET_ID,
  demoPepperSeed: 'ABHI-KYC-DEMO-PEPPER-v1',
  demoSaltSeed: 'ABHI-KYC-DEMO-SALT-v1',
  demoPepper: DEMO_PEPPER.toString('hex'),
  cnic: DEMO_CNIC,
  cnicNormalised: normaliseCnic(DEMO_CNIC),
  subjectId,
  merkleRoot,
  leafCount: leaves.length,
  leaves: leafTable,
  ewaDisclosure: {
    disclosed: EWA_DISCLOSURE,
    pathLengths: Object.fromEntries(bundle.attributes.map((a) => [a.name, a.path.length])),
    withheldValuesAbsentFromBundle: Object.fromEntries(
      withheld.map((w) => [w, serialisedBundle.includes(w)]),
    ),
  },
  chainLink: {
    description: 'SHA-256 of the v1 record marked SUPERSEDED and hashed AS STORED.',
    v1RecordCanonical: canonicalJSON(v1Record),
    previousVersionHash,
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'reference-vectors.json'), JSON.stringify(vectors, null, 2) + '\n');

console.log('ABHI KYC Ledger — reference vectors');
console.log('===================================');
console.log(`attributeSetId  ${ATTRIBUTE_SET_ID}`);
console.log(`subject_id      ${subjectId}`);
console.log(`merkle_root     ${merkleRoot}`);
console.log(`leaves          ${leaves.length}`);
console.log('');
console.log('Attribute                      Canonical                  Leaf (truncated)');
for (const row of leafTable) {
  console.log(
    `${row.attribute.padEnd(30)} ${row.canonical.padEnd(26)} ${row.leaf.slice(0, 24)}...`,
  );
}
console.log('');
console.log('EWA selective disclosure — 4 of 14 attributes:');
for (const a of bundle.attributes) {
  console.log(`  ${a.name.padEnd(20)} ${a.canonical.padEnd(14)} path = ${a.path.length} steps`);
}
console.log('');
console.log('Withheld values present in serialised bundle:');
for (const [value, present] of Object.entries(vectors.ewaDisclosure.withheldValuesAbsentFromBundle)) {
  console.log(`  ${JSON.stringify(value).padEnd(26)} ${present}`);
}
console.log('');
console.log(`previousVersionHash (v1 as stored)  ${previousVersionHash}`);
console.log('');
console.log(`Written to ${join(outDir, 'reference-vectors.json')}`);

if (ATTRIBUTE_NAMES.length !== 14) {
  throw new Error(`expected 14 attributes, found ${ATTRIBUTE_NAMES.length}`);
}
