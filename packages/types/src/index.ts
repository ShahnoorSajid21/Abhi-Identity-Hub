/**
 * @abhi/types — the domain model.
 *
 * Every interface here is the on-ledger or in-vault shape of a record, and
 * every one of them is PII-free by construction except VaultRecord, which is
 * ciphertext. That invariant is enforced at runtime by assertNoPII().
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ASSURANCE_LEVELS = ['A0', 'A1', 'A2', 'A3'] as const;
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

export const RECORD_STATUSES = ['ACTIVE', 'SUSPENDED', 'SUPERSEDED', 'SHREDDED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const VERIFICATION_METHODS = [
  'ASSERTED',
  'VERISYS',
  'DOC_AUTH',
  'BIOMETRIC_1TO1',
  'LIVENESS',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const MSP_IDS = ['ABHIBankMSP', 'ABHILendingMSP', 'ABHIComplianceMSP'] as const;
export type MspId = (typeof MSP_IDS)[number];

export const COMPLIANCE_MSP: MspId = 'ABHIComplianceMSP';

export type DecisionOutcome = 'ALLOW' | 'STEP_UP' | 'FULL_KYC' | 'DENY';

export type DecisionReason =
  | 'SUFFICIENT'
  | 'NO_RECORD'
  | 'SUSPENDED'
  | 'SHREDDED'
  | 'CNIC_EXPIRED'
  | 'ASSURANCE_LOW'
  | 'STALE';

/** Assurance ordering. A0 grants nothing; comparison is by rank, never by string. */
const ASSURANCE_RANK: Readonly<Record<AssuranceLevel, number>> = Object.freeze({
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
});

export function rankOf(level: AssuranceLevel): number {
  return ASSURANCE_RANK[level];
}

/**
 * Methods required for each assurance level (§6.3 of the blueprint).
 * A record claiming a level without these methods is rejected at write time —
 * this closes the assurance-inflation attack.
 */
export const REQUIRED_METHODS: Readonly<Record<AssuranceLevel, readonly VerificationMethod[]>> =
  Object.freeze({
    A0: Object.freeze(['ASSERTED'] as const),
    A1: Object.freeze(['VERISYS', 'DOC_AUTH'] as const),
    A2: Object.freeze(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'] as const),
    A3: Object.freeze(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1', 'LIVENESS'] as const),
  });

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface KYCRecord {
  docType: 'KYCRecord';
  subjectId: string;
  version: number;
  previousVersionHash: string | null;
  merkleRoot: string;
  attributeSetId: string;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  verifiedBy: string;
  verifiedAt: string;
  expiresAt: string;
  cnicExpiryAt: string;
  status: RecordStatus;
  statusReason: string | null;
  vaultRef: string;
  pepperEpoch: number;
  originProduct: string;
  createdTxId: string;
  schemaVersion: number;
}

export interface SubjectRegistry {
  docType: 'SubjectRegistry';
  subjectId: string;
  currentVersion: number;
  currentRecordKey: string;
  pepperEpoch: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
  status: RecordStatus;
  versionCount: number;
}

export interface ConsentRecord {
  docType: 'ConsentRecord';
  consentId: string;
  subjectId: string;
  grantedTo: string;
  purpose: string;
  scope: string[];
  grantedAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  revokedAt: string | null;
  revocationReason: string | null;
  evidenceRef: string;
  createdTxId: string;
  schemaVersion: number;
}

export interface VerificationEvent {
  docType: 'VerificationEvent';
  eventId: string;
  subjectId: string;
  method: VerificationMethod;
  outcome: boolean;
  provider: string;
  providerRef: string;
  performedBy: string;
  performedAt: string;
  product: string;
  costUnits: number;
  attemptNumber: number;
  resultingVersion: number | null;
  createdTxId: string;
}

export type AuditAction =
  | 'REGISTER'
  | 'VERIFY'
  | 'UPDATE'
  | 'SUSPEND'
  | 'REINSTATE'
  | 'CONSENT_GRANT'
  | 'CONSENT_REVOKE'
  | 'SHRED'
  | 'PROOF_ISSUED';

export interface AuditEvent {
  docType: 'AuditEvent';
  eventId: string;
  subjectId: string;
  action: AuditAction;
  decision: DecisionOutcome | null;
  decisionReason: string | null;
  requestedBy: string;
  requestedFor: string;
  policyId: string | null;
  attributesDisclosed: string[];
  occurredAt: string;
  txId: string;
  schemaVersion: number;
}

export interface ProductPolicy {
  docType: 'ProductPolicy';
  productId: string;
  policyVersion: number;
  minAssurance: AssuranceLevel;
  maxAgeDays: number;
  disclosableAttributes: string[];
  requireConsent: boolean;
  denyOnCnicExpiry: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedBy: string[];
  createdTxId: string;
}

/** Off-chain only. The one place ciphertext lives. Never on the ledger. */
export interface VaultRecord {
  vaultRef: string;
  subjectId: string;
  version: number;
  pepperEpoch: number;
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'ERR_UNKNOWN_MSP',
  'ERR_COMPLIANCE_ONLY',
  'ERR_INSUFFICIENT_ROLE',
  'ERR_PII_DETECTED',
  'ERR_PAYLOAD_TOO_LARGE',
  'ERR_SUBJECT_EXISTS',
  'ERR_SUBJECT_NOT_FOUND',
  'ERR_VERSION_CONFLICT',
  'ERR_CHAIN_BROKEN',
  'ERR_CHAIN_GAP',
  'ERR_REGISTRY_DIVERGENCE',
  'ERR_INVALID_TRANSITION',
  'ERR_ASSURANCE_MISMATCH',
  'ERR_INVALID_METHODS',
  'ERR_INVALID_SUBJECT',
  'ERR_INVALID_ROOT',
  'ERR_INVALID_EXPIRY',
  'ERR_ALREADY_EXPIRED',
  'ERR_REASON_REQUIRED',
  'ERR_INVALID_VAULTREF',
  'ERR_NO_VALID_CONSENT',
  'ERR_INVALID_SCOPE',
  'ERR_UNKNOWN_ATTRIBUTE',
  'ERR_UNKNOWN_GRANTEE',
  'ERR_EVIDENCE_REQUIRED',
  'ERR_LEGAL_BASIS_REQUIRED',
  'ERR_SHREDDED',
  'ERR_NOT_ACTIVE',
  'ERR_INVALID_CNIC',
  'ERR_PROOF_ASSEMBLY_FAILED',
  'ERR_ATTEMPT_CAP_EXCEEDED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Error codes that indicate an integrity or security event, not a user error. */
export const SECURITY_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ERR_PII_DETECTED',
  'ERR_CHAIN_BROKEN',
  'ERR_CHAIN_GAP',
  'ERR_REGISTRY_DIVERGENCE',
]);

export class KycError extends Error {
  override readonly name = 'KycError';
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }

  get isSecurityEvent(): boolean {
    return SECURITY_ERROR_CODES.has(this.code);
  }
}

export function fail(code: ErrorCode, detail?: string): never {
  throw new KycError(code, detail);
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
const ZERO64 = '0'.repeat(64);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Any run of 13+ consecutive digits. A CNIC is exactly 13 digits, so this is
 * the tripwire that keeps PII off an immutable ledger.
 *
 * Deliberately broad: it also catches 13 digits embedded inside a longer run,
 * because "6110112345678000" contains a CNIC just as surely as the bare value.
 */
const CNIC_SHAPED = /\d{13}/;

export function isHex64(s: unknown): s is string {
  return typeof s === 'string' && HEX64.test(s);
}

export function assertHex64(s: unknown, code: ErrorCode, field: string): asserts s is string {
  if (!isHex64(s)) fail(code, `${field} must be 64 lowercase hex characters`);
}

export function assertRfc3339(s: unknown, field: string): asserts s is string {
  if (typeof s !== 'string' || !RFC3339.test(s) || Number.isNaN(Date.parse(s))) {
    fail('ERR_INVALID_EXPIRY', `${field} must be an RFC 3339 timestamp`);
  }
}

export function assertUuidV4(s: unknown, field: string): asserts s is string {
  if (typeof s !== 'string' || !UUID_V4.test(s)) {
    fail('ERR_INVALID_VAULTREF', `${field} must be a UUID v4`);
  }
}

/**
 * Field names whose values are legitimately 64 hex characters AND are
 * separately validated as such by assertHex64 at write time.
 *
 * A 64-char hex string can legitimately contain 13 consecutive digits by
 * chance (hex includes 0-9), so these fields must be exempt from the CNIC
 * scan or they produce false positives. The exemption is granted BY FIELD
 * NAME, never by pattern — an earlier version stripped any 64-hex token
 * anywhere in the payload, which let a CNIC hide inside an unvalidated field
 * that merely looked like a hash (finding SEC-04).
 */
const HEX64_FIELDS: ReadonlySet<string> = new Set([
  'subjectId',
  'merkleRoot',
  'previousVersionHash',
  'recordHash',
  'hash',
  'salt',
  'leaf',
  'demoPepper',
]);

/** Composite state-key prefixes whose second segment is a subjectId. */
const COMPOSITE_KEY = /^(KYC|SUBJ|CONS|AEVT|VEVT)~[0-9a-f]{64}(~|$)/;

function scanValue(value: string, where: string): void {
  if (CNIC_SHAPED.test(value)) {
    fail('ERR_PII_DETECTED', `${where} contains a 13+ digit run resembling a CNIC`);
  }
}

function walk(node: unknown, path: string, depth: number): void {
  if (depth > 32) return;
  if (node === null || node === undefined) return;

  if (typeof node === 'string') {
    scanValue(node, path);
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean') return;

  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    return;
  }

  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // Keys can themselves be composite state keys embedding a subjectId.
      if (COMPOSITE_KEY.test(key)) {
        scanValue(key.replace(/[0-9a-f]{64}/, ''), `${path}.<key>`);
      } else {
        scanValue(key, `${path}.<key>`);
      }

      // Exempt only NAMED hex fields, and only when the value really is 64 hex.
      if (
        HEX64_FIELDS.has(key) &&
        typeof value === 'string' &&
        HEX64.test(value)
      ) {
        continue;
      }
      walk(value, `${path}.${key}`, depth + 1);
    }
  }
}

/**
 * The PII tripwire. Applied by chaincode to every mutating payload.
 *
 * Defence in depth, and redundant by design: the gateway is supposed to never
 * send a CNIC. The chaincode assumes the gateway is compromised and rejects
 * anything CNIC-shaped anyway. On an immutable ledger one leaked CNIC is a
 * permanent incident; a regex is the cheapest insurance available.
 *
 * Structural rather than textual: exemptions are granted per named field, so a
 * CNIC cannot hide inside a field that merely resembles a hash.
 *
 * Caller contract: pass a PARSED structure, or a single serialised string.
 * Only the outermost string is parsed. A string NESTED inside the payload is
 * scanned as raw text and claims no field-name exemption — deliberate, since
 * that is what stops SEC-04 returning one serialisation deeper, but it means a
 * doubly-serialised payload (e.g. a state-key -> serialised-record map passed
 * whole) false-positives whenever a hex64 identifier happens to contain 13
 * consecutive digits, which is roughly 4.5% of them. Parse before calling.
 * Pinned by 'a CNIC nested inside a serialised string is still caught' in
 * tests/security/regressions.test.ts, which also records why walk() must not
 * be changed to parse nested strings.
 */
export function assertNoPII(payload: unknown): void {
  if (typeof payload === 'string') {
    // A raw string may be a serialised structure — parse it so the structural
    // rules apply rather than falling back to blunt text scanning.
    try {
      walk(JSON.parse(payload), '$', 0);
      return;
    } catch {
      scanValue(payload, 'text');
      return;
    }
  }
  walk(payload, '$', 0);
}

/**
 * Text-mode scan for freeform content (log lines, exported blobs) where no
 * structure is available. Strips 64-hex runs to avoid false positives on
 * identifiers, and is therefore weaker than assertNoPII — use the structural
 * form wherever a parsed object exists.
 */
export function scanTextForPII(text: string): boolean {
  return CNIC_SHAPED.test(text.replace(/\b[0-9a-f]{64}\b/g, ''));
}

export function assertMaxBytes(payload: unknown, maxBytes: number): void {
  const serialised = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  if (Buffer.byteLength(serialised, 'utf8') > maxBytes) {
    fail('ERR_PAYLOAD_TOO_LARGE', `payload exceeds ${maxBytes} bytes`);
  }
}

/**
 * Level <-> methods consistency (§6.3). The level must be *derivable* from the
 * methods list, so a compromised gateway cannot simply assert a higher level.
 */
export function assertAssuranceConsistent(
  level: AssuranceLevel,
  methods: readonly VerificationMethod[],
): void {
  const required = REQUIRED_METHODS[level];
  const present = new Set(methods);
  for (const m of required) {
    if (!present.has(m)) {
      fail('ERR_ASSURANCE_MISMATCH', `${level} requires ${m}, which is absent from methods`);
    }
  }
  // A0 means "nothing was verified" — any real method contradicts the claim.
  if (level === 'A0' && methods.some((m) => m !== 'ASSERTED')) {
    fail('ERR_ASSURANCE_MISMATCH', 'A0 must not carry any verified method');
  }
  if (level !== 'A0' && present.has('ASSERTED')) {
    fail('ERR_ASSURANCE_MISMATCH', 'ASSERTED cannot coexist with verified methods');
  }
}

export function assertMethodsWellFormed(methods: unknown): asserts methods is VerificationMethod[] {
  if (!Array.isArray(methods) || methods.length === 0) {
    fail('ERR_INVALID_METHODS', 'methods must be a non-empty array');
  }
  const seen = new Set<string>();
  for (const m of methods) {
    if (!VERIFICATION_METHODS.includes(m as VerificationMethod)) {
      fail('ERR_INVALID_METHODS', `unknown method ${String(m)}`);
    }
    if (seen.has(m as string)) fail('ERR_INVALID_METHODS', `duplicate method ${String(m)}`);
    seen.add(m as string);
  }
  const sorted = [...methods].sort();
  if (sorted.join(',') !== (methods as string[]).join(',')) {
    fail('ERR_INVALID_METHODS', 'methods must be sorted');
  }
}

/** Full structural validation of a KYC record prior to write. */
export function validateKYCRecord(r: KYCRecord): void {
  assertHex64(r.subjectId, 'ERR_INVALID_SUBJECT', 'subjectId');
  assertHex64(r.merkleRoot, 'ERR_INVALID_ROOT', 'merkleRoot');
  if (r.merkleRoot === ZERO64) fail('ERR_INVALID_ROOT', 'merkleRoot must not be all zeroes');

  if (!Number.isInteger(r.version) || r.version < 1) {
    fail('ERR_VERSION_CONFLICT', 'version must be an integer >= 1');
  }

  // previousVersionHash is null iff version === 1 — the "iff" is the point.
  if (r.version === 1 && r.previousVersionHash !== null) {
    fail('ERR_CHAIN_BROKEN', 'version 1 must have a null previousVersionHash');
  }
  if (r.version > 1) {
    assertHex64(r.previousVersionHash, 'ERR_CHAIN_BROKEN', 'previousVersionHash');
  }

  if (!ASSURANCE_LEVELS.includes(r.assuranceLevel)) {
    fail('ERR_ASSURANCE_MISMATCH', 'unknown assurance level');
  }
  assertMethodsWellFormed(r.methods);
  assertAssuranceConsistent(r.assuranceLevel, r.methods);

  if (!RECORD_STATUSES.includes(r.status)) fail('ERR_INVALID_TRANSITION', 'unknown status');
  if ((r.status === 'SUSPENDED' || r.status === 'SHREDDED') && !r.statusReason?.trim()) {
    fail('ERR_REASON_REQUIRED', `${r.status} requires a statusReason`);
  }

  assertRfc3339(r.verifiedAt, 'verifiedAt');
  assertRfc3339(r.expiresAt, 'expiresAt');
  assertRfc3339(r.cnicExpiryAt, 'cnicExpiryAt');
  if (Date.parse(r.expiresAt) <= Date.parse(r.verifiedAt)) {
    fail('ERR_INVALID_EXPIRY', 'expiresAt must be after verifiedAt');
  }

  // A shredded record has had its vault pointer cleared, so exempt it.
  if (r.status !== 'SHREDDED') assertUuidV4(r.vaultRef, 'vaultRef');

  if (!Number.isInteger(r.pepperEpoch) || r.pepperEpoch < 1) {
    fail('ERR_INVALID_SUBJECT', 'pepperEpoch must be an integer >= 1');
  }

  assertNoPII(r);
  assertMaxBytes(r, 4096);
}
