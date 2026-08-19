/**
 * @abhi/canonical — deterministic serialisation.
 *
 * Two independent concerns live here, and both are load-bearing:
 *
 *  1. canonicalJSON  — byte-stable JSON for hashing ledger records. The chain
 *                      link hash is computed over this, so chaincode and gateway
 *                      MUST produce identical bytes or version chains become
 *                      unverifiable from a state export.
 *  2. canonicalValue — type-tagged encoding of an attribute value before it is
 *                      hashed into a Merkle leaf. Without the tag the string
 *                      "true" and the boolean true collide onto the same leaf.
 *
 * This package has zero dependencies by design. It is imported by chaincode,
 * which runs inside a Fabric container where every dependency is attack surface.
 */

/** Values permitted as KYC attribute values. */
export type AttrValue = string | boolean | number | Date;

/**
 * Type-tagged canonical form of an attribute value.
 *
 *   s: string   b: boolean (1/0)   n: number   d: date (YYYY-MM-DD)
 *
 * The tag is a domain separator across *types*. `canonicalValue('true')` and
 * `canonicalValue(true)` must never be equal, or an attacker could substitute
 * one for the other in a proof and it would still verify against the root.
 */
export function canonicalValue(v: AttrValue): string {
  if (typeof v === 'boolean') return `b:${v ? 1 : 0}`;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new CanonicalError('ERR_NON_FINITE_NUMBER');
    return `n:${v.toString()}`;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new CanonicalError('ERR_INVALID_DATE');
    return `d:${v.toISOString().slice(0, 10)}`;
  }
  if (typeof v === 'string') return `s:${v}`;
  throw new CanonicalError('ERR_UNSUPPORTED_VALUE_TYPE');
}

export class CanonicalError extends Error {
  override readonly name = 'CanonicalError';
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

/**
 * Deterministic JSON: object keys sorted lexicographically at every depth,
 * no insignificant whitespace, `undefined` properties dropped.
 *
 * Arrays keep their order — array order is semantically meaningful (e.g.
 * `methods` is sorted by the caller before it reaches here, deliberately, so
 * that sorting is an explicit domain decision rather than a serialisation
 * side effect).
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): JsonValue {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();

  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value as JsonPrimitive;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new CanonicalError('ERR_NON_FINITE_NUMBER');
    return value as number;
  }
  if (t === 'bigint') throw new CanonicalError('ERR_BIGINT_NOT_SERIALISABLE');
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new CanonicalError('ERR_UNSERIALISABLE_VALUE');
  }

  if (Array.isArray(value)) return value.map(normalise);

  const obj = value as Record<string, unknown>;
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue; // absent and explicit-undefined must agree
    out[key] = normalise(v);
  }
  return out;
}

/**
 * Zero-padded version segment for composite state keys.
 *
 * Without padding, `KYC~S~10` sorts before `KYC~S~2` and GetVersionChain
 * silently returns versions out of order — producing a chain that fails hash
 * verification for reasons that take a day to find.
 */
export function padVersion(version: number, width = 10): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new CanonicalError('ERR_INVALID_VERSION');
  }
  const s = String(version);
  if (s.length > width) throw new CanonicalError('ERR_VERSION_OVERFLOW');
  return s.padStart(width, '0');
}
