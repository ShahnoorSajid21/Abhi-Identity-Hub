import { createHash } from 'node:crypto';
import type { AttrValue } from '@abhi/canonical';
import type { Attribute } from './tree.ts';

/**
 * Attribute set ABHI-KYC-ATTRS-v1, drawn directly from the Asaan Digital
 * Account journey (Consolidated Product Manual v2, Part One §2).
 *
 * Adding an attribute produces v2 and a NEW root — it never mutates v1 records.
 * Mutating the set in place would invalidate every historical root in the bank.
 */
export const ATTRIBUTE_SET_ID = 'ABHI-KYC-ATTRS-v1';

export const ATTRIBUTE_NAMES = [
  'address_hash',
  'biometric_match',
  'cnic_expiry',
  'cnic_number_hash',
  'date_of_birth',
  'document_authenticity_pass',
  'fatca_status',
  'father_or_husband_name_hash',
  'full_name_hash',
  'liveness_pass',
  'profession',
  'purpose_of_account',
  'source_of_funds',
  'verisys_match',
] as const;

export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

export const ATTRIBUTE_SENSITIVITY: Readonly<Record<AttributeName, 'high' | 'medium' | 'low'>> =
  Object.freeze({
    address_hash: 'high',
    biometric_match: 'low',
    cnic_expiry: 'medium',
    cnic_number_hash: 'high',
    date_of_birth: 'high',
    document_authenticity_pass: 'low',
    fatca_status: 'medium',
    father_or_husband_name_hash: 'high',
    full_name_hash: 'high',
    liveness_pass: 'low',
    profession: 'medium',
    purpose_of_account: 'medium',
    source_of_funds: 'medium',
    verisys_match: 'low',
  });

export function isKnownAttribute(name: string): name is AttributeName {
  return (ATTRIBUTE_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Demonstration constants
// ---------------------------------------------------------------------------

/**
 * DEMONSTRATION ONLY. Never use these constants outside a demo.
 *
 * They are derived deterministically from a published seed rather than being
 * random, for one specific reason: it makes the worked example in the concept
 * document reproducible by any reviewer from the algorithm alone, without
 * anyone having to ship a file of secret salts alongside the paper.
 *
 * Production salts are 32 random bytes per attribute per record, generated in
 * the HSM and stored in the encrypted vault; the production pepper is a
 * non-extractable HSM key.
 */
const DEMO_PEPPER_SEED = 'ABHI-KYC-DEMO-PEPPER-v1';
const DEMO_SALT_SEED = 'ABHI-KYC-DEMO-SALT-v1';

export const DEMO_PEPPER: Buffer = createHash('sha256').update(DEMO_PEPPER_SEED).digest();

export function demoSalt(attributeName: string): Buffer {
  return createHash('sha256').update(`${DEMO_SALT_SEED}|${attributeName}`).digest();
}

/**
 * The reference subject from the concept document: CNIC 61101-1234567-8, an
 * ABHI wallet customer who has completed the Asaan Digital Account journey.
 *
 * Dates are carried as strings (`s:` tag) to match the canonical forms printed
 * in the concept document's worked example.
 */
export const DEMO_CNIC = '61101-1234567-8';

export const DEMO_ATTRIBUTE_VALUES: Readonly<Record<AttributeName, string | boolean>> =
  Object.freeze({
    address_hash: '486ea46224d1bb4f',
    biometric_match: true,
    cnic_expiry: '2031-04-11',
    cnic_number_hash: 'e3b0c44298fc1c14',
    date_of_birth: '1994-02-17',
    document_authenticity_pass: true,
    fatca_status: false,
    father_or_husband_name_hash: '2c26b46b68ffc68f',
    full_name_hash: '9f86d081884c7d65',
    liveness_pass: false,
    profession: 'Machine Operator',
    purpose_of_account: 'Salary disbursement',
    source_of_funds: 'Salary',
    verisys_match: true,
  });

/** Build the demo attribute set with deterministic salts. */
export function demoAttributes(): Attribute[] {
  return ATTRIBUTE_NAMES.map((name) => ({
    name,
    value: DEMO_ATTRIBUTE_VALUES[name],
    salt: demoSalt(name),
  }));
}

/** Build a production-shaped attribute set with caller-supplied random salts. */
export function buildAttributeSet(
  values: Partial<Record<AttributeName, AttrValue>>,
  saltFor: (name: string) => Buffer,
): Attribute[] {
  const out: Attribute[] = [];
  for (const name of ATTRIBUTE_NAMES) {
    const value = values[name];
    if (value === undefined) continue;
    out.push({ name, value, salt: saltFor(name) });
  }
  if (out.length === 0) throw new Error('no known attributes supplied');
  return out;
}
