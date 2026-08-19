import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Domain separation prefixes.
 *
 * Without these, an internal node can be presented as a leaf — the classic
 * Merkle second-preimage attack. An attacker who knows an internal node hash
 * could claim it as a leaf value and produce a shorter, still-valid path.
 */
export const LEAF_PREFIX = Buffer.from([0x00]);
export const NODE_PREFIX = Buffer.from([0x01]);
const SEP = Buffer.from([0x00]);

export const SALT_BYTES = 32;

export function newSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

/**
 *   leaf = SHA-256( 0x00 || salt || 0x00 || name || 0x00 || canonicalValue )
 *
 * The per-attribute salt is what stops `fatca_status = false` — which has two
 * possible values across the whole bank — from producing a byte-identical leaf
 * for every customer, instantly recognisable on the ledger.
 */
export function leafHash(salt: Buffer, name: string, canonical: string): Buffer {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  return createHash('sha256')
    .update(LEAF_PREFIX)
    .update(salt)
    .update(SEP)
    .update(Buffer.from(name, 'utf8'))
    .update(SEP)
    .update(Buffer.from(canonical, 'utf8'))
    .digest();
}

/** node = SHA-256( 0x01 || left || right ) */
export function nodeHash(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(NODE_PREFIX).update(left).update(right).digest();
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * subject_id = HMAC-SHA256(pepper, normalise(CNIC))
 *
 * A CNIC is 13 digits — about 10^13 values, exhaustible against plain SHA-256
 * on a commodity GPU in hours. Hashing a CNIC does NOT anonymise it. The
 * keyed construction is what makes on-chain identifiers uncorrelatable to real
 * people without the pepper.
 */
export function hmacSha256Hex(pepper: Buffer, message: Buffer | string): string {
  return createHmac('sha256', pepper).update(message).digest('hex');
}

/** Constant-time hex comparison — used wherever a mismatch is security-relevant. */
export function hexEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
