/**
 * API security controls: identity, rate limiting, idempotency, replay defence,
 * request signing.
 *
 * Closes SEC-02 and SEC-06.
 *
 * All of these are transport-level concerns that a production deployment would
 * normally split between an API gateway (Kong / AWS API Gateway) and the
 * service. They are implemented here so the POC is not merely *documented* as
 * having them, and so the semantics are pinned by tests rather than by a
 * vendor's default configuration.
 */
import { createHash, createHmac, timingSafeEqual, type X509Certificate } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { KycError, MSP_IDS } from '@abhi/types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface CallerIdentity {
  mspId: string;
  role: string | null;
  /** Distinguished name, for the audit trail. */
  subjectDn: string;
  source: 'mtls' | 'header';
  /**
   * The employer this caller acts for, when it acts for one.
   *
   * Only the employer bulk lookup uses it, and it is the whole of the SEC-05
   * control: the lookup reveals whether a CNIC is already known to ABHI, which
   * is acceptable only for people the caller demonstrably employs.
   *
   * It comes from the AUTHENTICATED PRINCIPAL, never from the request body. An
   * employer id in a payload is a field the caller chooses, which would make
   * the roster check a formality — any employer could name another and read
   * their roster.
   */
  employerId: string | null;
}

/**
 * Employer identity is carried in a dedicated OU of the client certificate,
 * `OU=employer:<id>`, alongside the role OU.
 *
 * Using a marked OU rather than reusing CN or the role OU keeps the two
 * separable: a certificate can say both "this is the employer portal" and
 * "acting for EMP-1042" without either being inferred from the other.
 */
const EMPLOYER_OU = /OU=employer:([^\n,/]+)/;

/**
 * Derive identity from the validated client certificate.
 *
 * PRODUCTION PATH. Identity comes from the certificate the TLS layer already
 * validated against the org CA — never from a header, because a header is
 * attacker-controlled. The `kyc.role` attribute is read from the certificate's
 * subject, matching the ABAC model the chaincode enforces.
 */
export function identityFromCertificate(cert: X509Certificate): CallerIdentity {
  const subject = cert.subject;

  const ou = /OU=([^\n,]+)/.exec(subject)?.[1]?.trim();
  const org = /\bO=([^\n,]+)/.exec(subject)?.[1]?.trim();

  if (org === undefined || !(MSP_IDS as readonly string[]).includes(org)) {
    throw new KycError('ERR_UNKNOWN_MSP', 'client certificate O= is not a network member');
  }

  return {
    mspId: org,
    // The role OU is whichever OU is not the employer marker.
    role: ou === undefined || ou.startsWith('employer:') ? null : ou,
    subjectDn: subject.replace(/\n/g, ','),
    source: 'mtls',
    employerId: EMPLOYER_OU.exec(subject)?.[1]?.trim() ?? null,
  };
}

/**
 * Development-only header identity.
 *
 * Throws in production. This is the guard that makes SEC-02 fail closed rather
 * than fail silently.
 */
export function identityFromHeaders(req: IncomingMessage): CallerIdentity {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('FATAL: header identity is not permitted in production; require mTLS');
  }
  return {
    mspId: (req.headers['x-abhi-msp'] as string | undefined) ?? 'ABHIBankMSP',
    role: (req.headers['x-abhi-role'] as string | undefined) ?? 'gateway',
    subjectDn: 'CN=dev,OU=gateway',
    source: 'header',
    /*
     * Defaults to the demo employer so the console's bulk upload exercises the
     * roster check rather than bypassing it. This whole function already
     * throws in production, so the default cannot reach a real deployment.
     */
    employerId:
      (req.headers['x-abhi-employer'] as string | undefined) ?? DEMO_EMPLOYER_ID,
  };
}

/**
 * The employer the POC's seeded roster belongs to.
 *
 * Exported so the bootstrap seeds the register under the same id the dev
 * header identity presents — otherwise the control is live but always denies,
 * which looks identical to the control being broken.
 */
export const DEMO_EMPLOYER_ID = 'EMP-DEMO';

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests per key per window. */
  max: number;
}

/**
 * Sliding-window rate limiter.
 *
 * Three dimensions are limited independently, and the SUBJECT dimension is the
 * one that matters most: it is what blunts enumeration of the customer base
 * (attack scenario S-5) and caps a cost-exhaustion attack against paid rails.
 */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #rules: Record<string, RateLimitRule>;

  constructor(rules: Record<string, RateLimitRule>) {
    this.#rules = rules;
  }

  /** Returns remaining allowance, or throws when the limit is exceeded. */
  check(dimension: string, key: string, now = Date.now()): number {
    const rule = this.#rules[dimension];
    if (rule === undefined) return Number.POSITIVE_INFINITY;

    const composite = `${dimension}|${key}`;
    const cutoff = now - rule.windowMs;
    const hits = (this.#hits.get(composite) ?? []).filter((t) => t > cutoff);

    if (hits.length >= rule.max) {
      throw new KycError(
        'ERR_ATTEMPT_CAP_EXCEEDED',
        `rate limit exceeded for ${dimension}: ${rule.max} per ${rule.windowMs}ms`,
      );
    }

    hits.push(now);
    this.#hits.set(composite, hits);
    return rule.max - hits.length;
  }

  /** Periodic cleanup so the map does not grow without bound. */
  sweep(now = Date.now()): void {
    const widest = Math.max(...Object.values(this.#rules).map((r) => r.windowMs), 0);
    for (const [key, hits] of this.#hits) {
      const live = hits.filter((t) => t > now - widest);
      if (live.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, live);
    }
  }
}

export const DEFAULT_RATE_RULES: Record<string, RateLimitRule> = {
  // Per calling product.
  product: { windowMs: 60_000, max: 600 },
  // Per subject — the enumeration and cost-attack control.
  subject: { windowMs: 60_000, max: 20 },
  // Employer bulk is expensive and is an existence oracle (SEC-05).
  employerBulk: { windowMs: 3_600_000, max: 5 },
  // Compliance operations are low-volume and high-impact.
  compliance: { windowMs: 60_000, max: 30 },
};

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

interface IdempotencyEntry {
  requestHash: string;
  status: number;
  body: unknown;
  storedAt: number;
}

/**
 * Idempotency for mutating endpoints.
 *
 * A replayed key with a DIFFERENT body is a conflict, not a cache hit — that
 * distinction is what stops an attacker reusing a legitimate key to smuggle a
 * different payload past a retry-tolerant client.
 */
export class IdempotencyStore {
  readonly #entries = new Map<string, IdempotencyEntry>();
  readonly #ttlMs: number;

  constructor(ttlMs = 24 * 3_600_000) {
    this.#ttlMs = ttlMs;
  }

  static hashRequest(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method}\n${path}\n${JSON.stringify(body ?? {})}`)
      .digest('hex');
  }

  lookup(key: string, requestHash: string, now = Date.now()): { status: number; body: unknown } | null {
    const entry = this.#entries.get(key);
    if (entry === undefined) return null;
    if (now - entry.storedAt > this.#ttlMs) {
      this.#entries.delete(key);
      return null;
    }
    if (entry.requestHash !== requestHash) {
      throw new KycError(
        'ERR_VERSION_CONFLICT',
        'idempotency key reused with a different request body',
      );
    }
    return { status: entry.status, body: entry.body };
  }

  store(key: string, requestHash: string, status: number, body: unknown, now = Date.now()): void {
    this.#entries.set(key, { requestHash, status, body, storedAt: now });
  }
}

// ---------------------------------------------------------------------------
// Replay defence
// ---------------------------------------------------------------------------

/**
 * Nonce cache with clock-skew tolerance.
 *
 * A signature alone does not prevent replay: a captured, correctly-signed
 * request stays valid forever without this.
 */
export class NonceCache {
  readonly #seen = new Map<string, number>();
  readonly #skewMs: number;

  constructor(skewMs = 60_000) {
    this.#skewMs = skewMs;
  }

  assertFresh(nonce: string, timestampIso: string, now = Date.now()): void {
    const ts = Date.parse(timestampIso);
    if (Number.isNaN(ts)) throw new KycError('ERR_INVALID_EXPIRY', 'invalid request timestamp');

    if (Math.abs(now - ts) > this.#skewMs) {
      throw new KycError('ERR_INVALID_EXPIRY', 'request timestamp outside the permitted skew');
    }
    if (this.#seen.has(nonce)) {
      throw new KycError('ERR_VERSION_CONFLICT', 'nonce already used — replay rejected');
    }

    this.#seen.set(nonce, now);

    // Evict anything older than the skew window; nothing outside it can be
    // accepted anyway, so retaining it serves no purpose.
    for (const [n, t] of this.#seen) {
      if (now - t > this.#skewMs * 2) this.#seen.delete(n);
    }
  }
}

// ---------------------------------------------------------------------------
// Request signing
// ---------------------------------------------------------------------------

export interface SignatureParts {
  method: string;
  path: string;
  bodyHash: string;
  timestamp: string;
  nonce: string;
}

export function canonicalSigningString(p: SignatureParts): string {
  return [p.method.toUpperCase(), p.path, p.bodyHash, p.timestamp, p.nonce].join('\n');
}

export function signRequest(secret: Buffer, parts: SignatureParts): string {
  return createHmac('sha256', secret).update(canonicalSigningString(parts)).digest('hex');
}

/**
 * Verify a request signature in constant time.
 *
 * A non-constant-time comparison here leaks the expected signature one byte at
 * a time to an attacker who can measure response latency.
 */
export function verifySignature(secret: Buffer, parts: SignatureParts, provided: string): boolean {
  const expected = signRequest(secret, parts);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

export function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

// ---------------------------------------------------------------------------
// Employer relationship gating (SEC-05)
// ---------------------------------------------------------------------------

/**
 * Employer -> CNIC relationship register.
 *
 * The employer bulk lookup reveals whether a CNIC is already verified at ABHI.
 * That is acceptable ONLY for people the employer actually employs. Without
 * this gate, an employer can enumerate ABHI's customer base one upload at a
 * time.
 *
 * In production this is backed by the employer portal's own roster, populated
 * when an employee is added and revoked when they leave. [OPEN-D] is the
 * product and legal decision on exactly what may then be displayed.
 */
export class EmploymentRegister {
  readonly #roster = new Map<string, Set<string>>();

  /** Assert an employment relationship, e.g. when HR adds an employee. */
  assert(employerId: string, normalisedCnic: string): void {
    const set = this.#roster.get(employerId) ?? new Set<string>();
    set.add(normalisedCnic);
    this.#roster.set(employerId, set);
  }

  revoke(employerId: string, normalisedCnic: string): void {
    this.#roster.get(employerId)?.delete(normalisedCnic);
  }

  has(employerId: string, normalisedCnic: string): boolean {
    return this.#roster.get(employerId)?.has(normalisedCnic) === true;
  }

  /**
   * Split a submitted list into those the employer may ask about and those it
   * may not. Unrelated CNICs are NOT looked up and NOT reported as unknown —
   * they are reported as unauthorised, so the response carries no information
   * about whether they exist at ABHI.
   */
  partition(
    employerId: string,
    cnics: readonly { raw: string; normalised: string | null }[],
  ): { permitted: string[]; unauthorised: string[] } {
    const permitted: string[] = [];
    const unauthorised: string[] = [];
    for (const c of cnics) {
      if (c.normalised !== null && this.has(employerId, c.normalised)) permitted.push(c.raw);
      else unauthorised.push(c.raw);
    }
    return { permitted, unauthorised };
  }
}
