import { canonicalJSON } from '@abhi/canonical';
import { sha256Hex, verifyProofBundle, type ProofBundle } from '@abhi/merkle';
import {
  fail,
  validateKYCRecord,
  assertAssuranceConsistent,
  assertMethodsWellFormed,
  assertRfc3339,
  type AssuranceLevel,
  type AuditAction,
  type AuditEvent,
  type ConsentRecord,
  type KYCRecord,
  type ProductPolicy,
  type RecordStatus,
  type SubjectRegistry,
  type VerificationEvent,
  type VerificationMethod,
} from '@abhi/types';
import { KEY, type StateStore, type TxContext } from './state.ts';
import { guard, requireNonEmpty } from './guards.ts';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function readJson<T>(store: StateStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

async function writeJson(store: StateStore, key: string, value: unknown): Promise<string> {
  const serialised = canonicalJSON(value);
  await store.put(key, serialised);
  return serialised;
}

/**
 * Deterministic event identifier.
 *
 * Derived from the transaction ID plus a within-transaction ordinal, both of
 * which every endorsing peer computes identically. A module-level counter here
 * would diverge across peers and break endorsement (finding SEC-11).
 */
function nextEventId(ctx: TxContext, kind: string): string {
  return `${kind}-${ctx.txId}-${String(ctx.nextOrdinal()).padStart(4, '0')}`;
}

async function appendAudit(
  store: StateStore,
  ctx: TxContext,
  event: Omit<AuditEvent, 'docType' | 'eventId' | 'occurredAt' | 'txId' | 'schemaVersion'>,
): Promise<void> {
  const occurredAt = iso(ctx.timestamp);
  const full: AuditEvent = {
    docType: 'AuditEvent',
    eventId: nextEventId(ctx, 'aevt'),
    occurredAt,
    txId: ctx.txId,
    schemaVersion: SCHEMA_VERSION,
    ...event,
  };
  await writeJson(store, KEY.auditEvent(event.subjectId, occurredAt, full.eventId), full);
}

/** Hash a record exactly as it is stored. Used for every chain link. */
export function hashRecordAsStored(record: KYCRecord): string {
  return sha256Hex(canonicalJSON(record));
}

// ---------------------------------------------------------------------------
// 1. RegisterKYC
// ---------------------------------------------------------------------------

export interface RegisterKYCInput {
  subjectId: string;
  merkleRoot: string;
  attributeSetId: string;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  expiresAt: string;
  cnicExpiryAt: string;
  vaultRef: string;
  pepperEpoch: number;
  originProduct: string;
}

export interface RegisterKYCResult {
  subjectId: string;
  version: number;
  txId: string;
  status: RecordStatus;
  recordHash: string;
}

/**
 * Create version 1 for a subject the ledger has never seen.
 * Endorsement: Compliance AND (Bank OR Lending).
 */
export async function registerKYC(
  store: StateStore,
  ctx: TxContext,
  input: RegisterKYCInput,
): Promise<RegisterKYCResult> {
  guard(ctx, { payload: input });

  if ((await store.get(KEY.registry(input.subjectId))) !== null) {
    fail('ERR_SUBJECT_EXISTS', 'subject already registered; use UpdateKYC');
  }

  assertMethodsWellFormed(input.methods);
  assertAssuranceConsistent(input.assuranceLevel, input.methods);
  assertRfc3339(input.expiresAt, 'expiresAt');
  assertRfc3339(input.cnicExpiryAt, 'cnicExpiryAt');

  const now = ctx.timestamp;
  if (Date.parse(input.expiresAt) <= now.getTime()) {
    fail('ERR_ALREADY_EXPIRED', 'expiresAt must be in the future');
  }

  const record: KYCRecord = {
    docType: 'KYCRecord',
    subjectId: input.subjectId,
    version: 1,
    previousVersionHash: null,
    merkleRoot: input.merkleRoot,
    attributeSetId: input.attributeSetId,
    assuranceLevel: input.assuranceLevel,
    methods: [...input.methods].sort(),
    // verifiedBy and verifiedAt are taken from the transaction, NEVER from the
    // payload. A gateway with a skewed or manipulated clock could otherwise
    // backdate a verification and extend its validity window.
    verifiedBy: ctx.mspId,
    verifiedAt: iso(now),
    expiresAt: input.expiresAt,
    cnicExpiryAt: input.cnicExpiryAt,
    status: 'ACTIVE',
    statusReason: null,
    vaultRef: input.vaultRef,
    pepperEpoch: input.pepperEpoch,
    originProduct: input.originProduct,
    createdTxId: ctx.txId,
    schemaVersion: SCHEMA_VERSION,
  };

  validateKYCRecord(record);

  const recordKey = KEY.kycRecord(record.subjectId, 1);
  const serialised = await writeJson(store, recordKey, record);

  const registry: SubjectRegistry = {
    docType: 'SubjectRegistry',
    subjectId: record.subjectId,
    currentVersion: 1,
    currentRecordKey: recordKey,
    pepperEpoch: record.pepperEpoch,
    firstSeenAt: record.verifiedAt,
    lastUpdatedAt: record.verifiedAt,
    status: 'ACTIVE',
    versionCount: 1,
  };
  await writeJson(store, KEY.registry(record.subjectId), registry);

  await appendAudit(store, ctx, {
    subjectId: record.subjectId,
    action: 'REGISTER',
    decision: null,
    decisionReason: null,
    requestedBy: ctx.mspId,
    requestedFor: input.originProduct,
    policyId: null,
    attributesDisclosed: [],
  });

  ctx.setEvent('KYCRegistered', {
    subjectId: record.subjectId,
    version: 1,
    assuranceLevel: record.assuranceLevel,
  });

  return {
    subjectId: record.subjectId,
    version: 1,
    txId: ctx.txId,
    status: 'ACTIVE',
    recordHash: sha256Hex(serialised),
  };
}

// ---------------------------------------------------------------------------
// 2. VerifyKYC  (query — no commit)
// ---------------------------------------------------------------------------

export interface VerifyKYCResult {
  found: boolean;
  subjectId: string;
  version: number | null;
  assuranceLevel: AssuranceLevel | null;
  methods: VerificationMethod[];
  status: RecordStatus | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  cnicExpiryAt: string | null;
  merkleRoot: string | null;
  attributeSetId: string | null;
  ageDays: number | null;
  cnicExpired: boolean;
}

/**
 * Return the current record and the inputs a product needs for its decision.
 *
 * Deliberately returns FACTS, NOT A DECISION. The decision belongs to the
 * gateway's policy engine (principle P5), because product policy changes far
 * more often than the ledger should. The decision is written back as an
 * AuditEvent, so the ledger still holds the complete record of what was
 * decided and why.
 */
export async function verifyKYC(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
): Promise<VerifyKYCResult> {
  guard(ctx, {});

  const empty: VerifyKYCResult = {
    found: false,
    subjectId,
    version: null,
    assuranceLevel: null,
    methods: [],
    status: null,
    verifiedAt: null,
    expiresAt: null,
    cnicExpiryAt: null,
    merkleRoot: null,
    attributeSetId: null,
    ageDays: null,
    cnicExpired: false,
  };

  const registry = await readJson<SubjectRegistry>(store, KEY.registry(subjectId));
  if (registry === null) return empty;

  const record = await readJson<KYCRecord>(store, registry.currentRecordKey);
  if (record === null) fail('ERR_REGISTRY_DIVERGENCE', 'registry points at a missing record');

  // Registry/record divergence means a partially-applied write or state
  // corruption. Failing loudly is far safer than answering from a stale pointer.
  if (record.version !== registry.currentVersion) {
    fail('ERR_REGISTRY_DIVERGENCE', 'registry version disagrees with record version');
  }
  if (record.status !== registry.status) {
    fail('ERR_REGISTRY_DIVERGENCE', 'registry status disagrees with record status');
  }

  const now = ctx.timestamp.getTime();
  return {
    found: true,
    subjectId,
    version: record.version,
    assuranceLevel: record.assuranceLevel,
    methods: record.methods,
    status: record.status,
    verifiedAt: record.verifiedAt,
    expiresAt: record.expiresAt,
    cnicExpiryAt: record.cnicExpiryAt,
    merkleRoot: record.merkleRoot,
    attributeSetId: record.attributeSetId,
    ageDays: Math.floor((now - Date.parse(record.verifiedAt)) / 86_400_000),
    cnicExpired: Date.parse(record.cnicExpiryAt) <= now,
  };
}

// ---------------------------------------------------------------------------
// 3. UpdateKYC
// ---------------------------------------------------------------------------

export interface UpdateKYCInput {
  subjectId: string;
  expectedCurrentVersion: number;
  merkleRoot: string;
  attributeSetId: string;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  expiresAt: string;
  cnicExpiryAt: string;
  vaultRef: string;
  updateReason: string;
}

export interface UpdateKYCResult {
  subjectId: string;
  version: number;
  previousVersionHash: string;
  txId: string;
  recordHash: string;
}

/**
 * Append a new version — step-up, CNIC renewal, attribute change, re-verification.
 */
export async function updateKYC(
  store: StateStore,
  ctx: TxContext,
  input: UpdateKYCInput,
): Promise<UpdateKYCResult> {
  guard(ctx, { payload: input });
  requireNonEmpty(input.updateReason, 'ERR_REASON_REQUIRED', 'updateReason');

  const registryKey = KEY.registry(input.subjectId);
  const registry = await readJson<SubjectRegistry>(store, registryKey);
  if (registry === null) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

  if (registry.currentVersion !== input.expectedCurrentVersion) {
    fail(
      'ERR_VERSION_CONFLICT',
      `expected version ${input.expectedCurrentVersion}, ledger holds ${registry.currentVersion}`,
    );
  }

  const prevKey = registry.currentRecordKey;
  const prev = await readJson<KYCRecord>(store, prevKey);
  if (prev === null) fail('ERR_REGISTRY_DIVERGENCE', 'registry points at a missing record');

  if (prev.status === 'SHREDDED') fail('ERR_SHREDDED', 'cannot update an erased subject');
  if (prev.status === 'SUPERSEDED') {
    fail('ERR_INVALID_TRANSITION', 'current record is already superseded');
  }

  assertMethodsWellFormed(input.methods);
  assertAssuranceConsistent(input.assuranceLevel, input.methods);
  assertRfc3339(input.expiresAt, 'expiresAt');
  assertRfc3339(input.cnicExpiryAt, 'cnicExpiryAt');

  // ------------------------------------------------------------------
  // ORDER IS LOAD-BEARING. Do not reorder these three statements.
  //
  // The predecessor must be marked SUPERSEDED and PERSISTED first, and the
  // chain link must hash it AS STORED. Hashing the pre-supersession form
  // produces a chain that cannot be verified from a state export — an auditor
  // recomputing hashes from exported state would get a mismatch on every link,
  // which quietly defeats the entire audit property.
  //
  // Covered by test: chain-hash-post-supersession.
  // ------------------------------------------------------------------
  const supersededPrev: KYCRecord = { ...prev, status: 'SUPERSEDED' };
  const prevSerialised = await writeJson(store, prevKey, supersededPrev);
  const previousVersionHash = sha256Hex(prevSerialised);

  const nextVersion = prev.version + 1;
  const now = ctx.timestamp;

  const record: KYCRecord = {
    docType: 'KYCRecord',
    subjectId: input.subjectId,
    version: nextVersion,
    previousVersionHash,
    merkleRoot: input.merkleRoot,
    attributeSetId: input.attributeSetId,
    assuranceLevel: input.assuranceLevel,
    methods: [...input.methods].sort(),
    verifiedBy: ctx.mspId,
    verifiedAt: iso(now),
    expiresAt: input.expiresAt,
    cnicExpiryAt: input.cnicExpiryAt,
    // A suspension is carried forward. Only ReinstateKYC clears it —
    // suppressing the update instead would create a gap in history at exactly
    // the moment the record is under scrutiny.
    status: prev.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    statusReason: prev.status === 'SUSPENDED' ? prev.statusReason : null,
    vaultRef: input.vaultRef,
    pepperEpoch: prev.pepperEpoch,
    originProduct: prev.originProduct,
    createdTxId: ctx.txId,
    schemaVersion: SCHEMA_VERSION,
  };

  validateKYCRecord(record);

  const recordKey = KEY.kycRecord(record.subjectId, nextVersion);
  const serialised = await writeJson(store, recordKey, record);

  await writeJson(store, registryKey, {
    ...registry,
    currentVersion: nextVersion,
    currentRecordKey: recordKey,
    lastUpdatedAt: record.verifiedAt,
    status: record.status,
    versionCount: registry.versionCount + 1,
  } satisfies SubjectRegistry);

  await appendAudit(store, ctx, {
    subjectId: record.subjectId,
    action: 'UPDATE',
    decision: null,
    decisionReason: input.updateReason,
    requestedBy: ctx.mspId,
    requestedFor: record.originProduct,
    policyId: null,
    attributesDisclosed: [],
  });

  ctx.setEvent('KYCUpdated', {
    subjectId: record.subjectId,
    version: nextVersion,
    from: prev.assuranceLevel,
    to: record.assuranceLevel,
    reason: input.updateReason,
  });

  return {
    subjectId: record.subjectId,
    version: nextVersion,
    previousVersionHash,
    txId: ctx.txId,
    recordHash: sha256Hex(serialised),
  };
}

// ---------------------------------------------------------------------------
// 4/5. SuspendKYC / ReinstateKYC
// ---------------------------------------------------------------------------

export interface StatusChangeResult {
  subjectId: string;
  version: number;
  status: RecordStatus;
  txId: string;
}

async function changeStatus(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  from: RecordStatus,
  to: RecordStatus,
  reason: string,
  referenceId: string,
  action: AuditAction,
  eventName: string,
): Promise<StatusChangeResult> {
  guard(ctx, { complianceOnly: true, role: 'compliance-officer', payload: { subjectId, reason, referenceId } });
  requireNonEmpty(reason, 'ERR_REASON_REQUIRED', 'reason');
  requireNonEmpty(referenceId, 'ERR_REASON_REQUIRED', 'referenceId');

  const registryKey = KEY.registry(subjectId);
  const registry = await readJson<SubjectRegistry>(store, registryKey);
  if (registry === null) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

  const record = await readJson<KYCRecord>(store, registry.currentRecordKey);
  if (record === null) fail('ERR_REGISTRY_DIVERGENCE', 'registry points at a missing record');

  if (record.status !== from) {
    fail('ERR_INVALID_TRANSITION', `record status is ${record.status}, expected ${from}`);
  }

  // NOTE — a deliberate exception to append-only, called out so a reviewer can
  // challenge it rather than discover it. Suspension flips status on the
  // CURRENT version rather than appending, for two reasons: it must take
  // effect with no window in which products could read a stale ACTIVE pointer,
  // and the change is confined to two fields with full prior state recoverable
  // via Fabric's GetHistoryForKey. The AuditEvent below is the permanent append.
  const updated: KYCRecord = {
    ...record,
    status: to,
    statusReason: to === 'ACTIVE' ? null : `${reason} [${referenceId}]`,
  };
  await writeJson(store, registry.currentRecordKey, updated);
  await writeJson(store, registryKey, {
    ...registry,
    status: to,
    lastUpdatedAt: iso(ctx.timestamp),
  } satisfies SubjectRegistry);

  await appendAudit(store, ctx, {
    subjectId,
    action,
    decision: null,
    decisionReason: `${reason} [${referenceId}]`,
    requestedBy: ctx.mspId,
    requestedFor: 'COMPLIANCE',
    policyId: null,
    attributesDisclosed: [],
  });

  ctx.setEvent(eventName, { subjectId, version: record.version, reason });

  return { subjectId, version: record.version, status: to, txId: ctx.txId };
}

/**
 * Freeze a subject's identity standing across every product, immediately.
 * Compliance MSP only, kyc.role=compliance-officer.
 *
 * This is the control that makes a risk function comfortable with the whole
 * idea: stop a customer everywhere, instantly, without opening tickets with
 * five product teams.
 */
export function suspendKYC(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  reason: string,
  referenceId: string,
): Promise<StatusChangeResult> {
  return changeStatus(store, ctx, subjectId, 'ACTIVE', 'SUSPENDED', reason, referenceId, 'SUSPEND', 'KYCSuspended');
}

/**
 * Lift a suspension after investigation closes.
 *
 * Explicitly does NOT alter assuranceLevel, expiresAt or verifiedAt.
 * Reinstatement restores standing; it is not a re-verification. Conflating the
 * two would let a suspend/reinstate cycle silently refresh a stale KYC — which
 * is precisely the kind of quiet control bypass an auditor looks for.
 */
export function reinstateKYC(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  reason: string,
  referenceId: string,
): Promise<StatusChangeResult> {
  return changeStatus(store, ctx, subjectId, 'SUSPENDED', 'ACTIVE', reason, referenceId, 'REINSTATE', 'KYCReinstated');
}

// ---------------------------------------------------------------------------
// 6/7. RecordConsent / RevokeConsent
// ---------------------------------------------------------------------------

export interface RecordConsentInput {
  consentId: string;
  subjectId: string;
  grantedTo: string;
  purpose: string;
  scope: string[];
  expiresAt: string;
  evidenceRef: string;
}

export const MAX_CONSENT_DAYS = 730;

export async function recordConsent(
  store: StateStore,
  ctx: TxContext,
  input: RecordConsentInput,
  knownAttributes: readonly string[],
  /**
   * Maximum scope the grantee could ever be entitled to — normally the union
   * of disclosable attributes across that organization's product policies.
   *
   * Narrowing already happens at GenerateProof time, so omitting this cannot
   * cause over-disclosure. It is enforced here so a consent broader than any
   * policy would honour cannot be RECORDED, which was confusing in audit
   * (finding SEC-10).
   */
  maxScope?: readonly string[],
): Promise<{ consentId: string; txId: string }> {
  guard(ctx, { payload: input });

  if ((await store.get(KEY.registry(input.subjectId))) === null) {
    fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');
  }

  if (!Array.isArray(input.scope) || input.scope.length === 0) {
    fail('ERR_INVALID_SCOPE', 'scope must be a non-empty array');
  }
  // A wildcard would silently widen as the attribute set grows.
  if (input.scope.includes('*')) fail('ERR_INVALID_SCOPE', 'wildcard scope is not permitted');

  for (const attr of input.scope) {
    if (!knownAttributes.includes(attr)) {
      fail('ERR_UNKNOWN_ATTRIBUTE', `${attr} is not in the attribute set`);
    }
  }

  if (maxScope !== undefined) {
    const permitted = new Set(maxScope);
    const excess = input.scope.filter((a) => !permitted.has(a));
    if (excess.length > 0) {
      fail(
        'ERR_INVALID_SCOPE',
        `scope exceeds what any policy for ${input.grantedTo} permits: ${excess.join(', ')}`,
      );
    }
  }

  assertRfc3339(input.expiresAt, 'expiresAt');
  const now = ctx.timestamp.getTime();
  const expiry = Date.parse(input.expiresAt);
  if (expiry <= now) fail('ERR_INVALID_EXPIRY', 'consent must expire in the future');
  if (expiry > now + MAX_CONSENT_DAYS * 86_400_000) {
    fail('ERR_INVALID_EXPIRY', `consent may not exceed ${MAX_CONSENT_DAYS} days`);
  }

  requireNonEmpty(input.evidenceRef, 'ERR_EVIDENCE_REQUIRED', 'evidenceRef');
  requireNonEmpty(input.purpose, 'ERR_INVALID_SCOPE', 'purpose');

  const consent: ConsentRecord = {
    docType: 'ConsentRecord',
    consentId: input.consentId,
    subjectId: input.subjectId,
    grantedTo: input.grantedTo,
    purpose: input.purpose,
    scope: [...input.scope].sort(),
    grantedAt: iso(ctx.timestamp),
    expiresAt: input.expiresAt,
    status: 'ACTIVE',
    revokedAt: null,
    revocationReason: null,
    evidenceRef: input.evidenceRef,
    createdTxId: ctx.txId,
    schemaVersion: SCHEMA_VERSION,
  };

  await writeJson(store, KEY.consent(consent.subjectId, consent.grantedTo, consent.consentId), consent);

  await appendAudit(store, ctx, {
    subjectId: consent.subjectId,
    action: 'CONSENT_GRANT',
    decision: null,
    decisionReason: consent.purpose,
    requestedBy: ctx.mspId,
    requestedFor: consent.grantedTo,
    policyId: null,
    attributesDisclosed: consent.scope,
  });

  ctx.setEvent('ConsentRecorded', {
    subjectId: consent.subjectId,
    grantedTo: consent.grantedTo,
    purpose: consent.purpose,
  });

  return { consentId: consent.consentId, txId: ctx.txId };
}

/**
 * Withdraw a consent.
 *
 * NOT retroactive, and the design does not pretend otherwise. Revocation stops
 * FUTURE disclosure; it cannot un-disclose what was already released. The
 * audit trail shows exactly what was released, when, under which consent.
 */
export async function revokeConsent(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  grantedTo: string,
  consentId: string,
  reason: string,
): Promise<{ consentId: string; txId: string }> {
  guard(ctx, { payload: { subjectId, grantedTo, consentId, reason } });
  requireNonEmpty(reason, 'ERR_REASON_REQUIRED', 'reason');

  const key = KEY.consent(subjectId, grantedTo, consentId);
  const consent = await readJson<ConsentRecord>(store, key);
  if (consent === null) fail('ERR_NO_VALID_CONSENT', 'no such consent');
  if (consent.status !== 'ACTIVE') fail('ERR_NO_VALID_CONSENT', `consent is ${consent.status}`);

  await writeJson(store, key, {
    ...consent,
    status: 'REVOKED',
    revokedAt: iso(ctx.timestamp),
    revocationReason: reason,
  } satisfies ConsentRecord);

  await appendAudit(store, ctx, {
    subjectId,
    action: 'CONSENT_REVOKE',
    decision: null,
    decisionReason: reason,
    requestedBy: ctx.mspId,
    requestedFor: grantedTo,
    policyId: null,
    attributesDisclosed: [],
  });

  ctx.setEvent('ConsentRevoked', { subjectId, grantedTo, consentId });
  return { consentId, txId: ctx.txId };
}

// ---------------------------------------------------------------------------
// 8. MarkShredded
// ---------------------------------------------------------------------------

/**
 * Record that off-chain data for a subject has been destroyed.
 *
 * Ordering across systems matters as much as ordering within the transaction:
 * vault destruction happens BEFORE this call. If this call then fails, the
 * system is in a recoverable state — data gone, ledger not yet marked — and a
 * reconciliation job detects and completes it. Reverse the order and a failed
 * vault destruction leaves the ledger asserting an erasure that did not
 * happen, which is a false compliance record and far worse.
 */
export async function markShredded(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  reason: string,
  legalBasis: string,
  shredCertificateRef: string,
): Promise<StatusChangeResult> {
  guard(ctx, {
    complianceOnly: true,
    role: 'compliance-officer',
    payload: { subjectId, reason, legalBasis, shredCertificateRef },
  });
  requireNonEmpty(reason, 'ERR_REASON_REQUIRED', 'reason');
  requireNonEmpty(legalBasis, 'ERR_LEGAL_BASIS_REQUIRED', 'legalBasis');
  requireNonEmpty(shredCertificateRef, 'ERR_EVIDENCE_REQUIRED', 'shredCertificateRef');

  const registryKey = KEY.registry(subjectId);
  const registry = await readJson<SubjectRegistry>(store, registryKey);
  if (registry === null) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

  const record = await readJson<KYCRecord>(store, registry.currentRecordKey);
  if (record === null) fail('ERR_REGISTRY_DIVERGENCE', 'registry points at a missing record');
  if (record.status === 'SHREDDED') fail('ERR_INVALID_TRANSITION', 'already shredded');
  if (record.status === 'SUPERSEDED') fail('ERR_INVALID_TRANSITION', 'cannot shred a superseded version');

  // merkleRoot is deliberately NOT cleared. It remains as 32 bytes whose
  // preimage no longer exists anywhere — the audit fact survives, the personal
  // data does not.
  await writeJson(store, registry.currentRecordKey, {
    ...record,
    status: 'SHREDDED',
    statusReason: `${reason} [${shredCertificateRef}]`,
    vaultRef: '',
  } satisfies KYCRecord);

  await writeJson(store, registryKey, {
    ...registry,
    status: 'SHREDDED',
    lastUpdatedAt: iso(ctx.timestamp),
  } satisfies SubjectRegistry);

  // Revoke every outstanding consent — erasure implies withdrawal.
  const consents = await store.getRange(KEY.consentRangeStart(subjectId), KEY.consentRangeEnd(subjectId));
  for (const { key, value } of consents) {
    const c = JSON.parse(value) as ConsentRecord;
    if (c.status === 'ACTIVE') {
      await writeJson(store, key, {
        ...c,
        status: 'REVOKED',
        revokedAt: iso(ctx.timestamp),
        revocationReason: 'SUBJECT_ERASED',
      } satisfies ConsentRecord);
    }
  }

  await appendAudit(store, ctx, {
    subjectId,
    action: 'SHRED',
    decision: null,
    decisionReason: `${reason} | legalBasis=${legalBasis}`,
    requestedBy: ctx.mspId,
    requestedFor: 'COMPLIANCE',
    policyId: null,
    attributesDisclosed: [],
  });

  ctx.setEvent('KYCShredded', { subjectId, legalBasis });
  return { subjectId, version: record.version, status: 'SHREDDED', txId: ctx.txId };
}

// ---------------------------------------------------------------------------
// 9. GetVersionChain
// ---------------------------------------------------------------------------

export interface VersionChainResult {
  subjectId: string;
  versionCount: number;
  chainValid: boolean;
  brokenAt: number | null;
  versions: KYCRecord[];
}

/**
 * Return the complete version history with hash-link integrity verified.
 *
 * This is THE audit deliverable. The chain is modelled explicitly in record
 * state rather than relying on Fabric's GetHistoryForKey, so any third party
 * can verify it from a state export alone — without peer access or an
 * understanding of Fabric's internals. An SBP inspector should not have to
 * trust ABHI's blockchain in order to verify ABHI's history.
 *
 * If chainValid is ever false in production that is a P1 SECURITY INCIDENT,
 * not a data-quality ticket: it means state was altered outside chaincode.
 */
export async function getVersionChain(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  verifyIntegrity = true,
): Promise<VersionChainResult> {
  guard(ctx, {});

  const rows = await store.getRange(KEY.kycRangeStart(subjectId), KEY.kycRangeEnd(subjectId));
  const versions = rows.map((r) => JSON.parse(r.value) as KYCRecord);

  if (versions.length === 0) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

  // Versions must be 1..n with no gaps.
  for (let i = 0; i < versions.length; i++) {
    if (versions[i]!.version !== i + 1) {
      fail('ERR_CHAIN_GAP', `expected version ${i + 1}, found ${versions[i]!.version}`);
    }
  }

  let chainValid = true;
  let brokenAt: number | null = null;

  if (verifyIntegrity) {
    for (let i = 1; i < versions.length; i++) {
      const expected = hashRecordAsStored(versions[i - 1]!);
      if (versions[i]!.previousVersionHash !== expected) {
        chainValid = false;
        brokenAt = versions[i]!.version;
        break;
      }
    }
  }

  return { subjectId, versionCount: versions.length, chainValid, brokenAt, versions };
}

// ---------------------------------------------------------------------------
// 10. GenerateProof  (authorisation only)
// ---------------------------------------------------------------------------

export interface GenerateProofResult {
  authorised: boolean;
  merkleRoot: string | null;
  attributeSetId: string | null;
  version: number | null;
  grantedAttributes: string[];
  denied: string[];
  proofIssuanceId: string;
}

/**
 * Authorise and record the issuance of a selective-disclosure proof.
 *
 * The chaincode does NOT build Merkle proofs — it cannot, because it has no
 * access to salts or attribute values by design (principle P1). It authorises
 * issuance, records it, and returns the root the gateway must verify against.
 */
export async function generateProof(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  productId: string,
  requestedAttributes: readonly string[],
  consentId: string,
  policy: ProductPolicy,
): Promise<GenerateProofResult> {
  guard(ctx, {});

  const registry = await readJson<SubjectRegistry>(store, KEY.registry(subjectId));
  if (registry === null) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

  const record = await readJson<KYCRecord>(store, registry.currentRecordKey);
  if (record === null) fail('ERR_REGISTRY_DIVERGENCE', 'registry points at a missing record');
  if (record.status !== 'ACTIVE') fail('ERR_NOT_ACTIVE', `record is ${record.status}`);

  const consent = await readJson<ConsentRecord>(store, KEY.consent(subjectId, ctx.mspId, consentId));
  if (consent === null) fail('ERR_NO_VALID_CONSENT', 'no consent for this organization');
  if (consent.status !== 'ACTIVE') fail('ERR_NO_VALID_CONSENT', `consent is ${consent.status}`);
  if (Date.parse(consent.expiresAt) <= ctx.timestamp.getTime()) {
    fail('ERR_NO_VALID_CONSENT', 'consent has expired');
  }

  // Least disclosure (P4) as one expression: the three-way intersection of
  // what was asked for, what the customer consented to, and what the product's
  // policy permits. The narrowest wins, always.
  const consentScope = new Set(consent.scope);
  const policyAttrs = new Set(policy.disclosableAttributes);
  const granted: string[] = [];
  const denied: string[] = [];
  for (const attr of requestedAttributes) {
    if (consentScope.has(attr) && policyAttrs.has(attr)) granted.push(attr);
    else denied.push(attr);
  }
  granted.sort();
  denied.sort();

  const proofIssuanceId = nextEventId(ctx, 'proof');

  await appendAudit(store, ctx, {
    subjectId,
    action: 'PROOF_ISSUED',
    decision: 'ALLOW',
    decisionReason: 'SUFFICIENT',
    requestedBy: ctx.mspId,
    requestedFor: productId,
    policyId: `${policy.productId}@v${policy.policyVersion}`,
    attributesDisclosed: granted,
  });

  ctx.setEvent('ProofIssued', { subjectId, productId, count: granted.length });

  return {
    authorised: granted.length > 0,
    merkleRoot: record.merkleRoot,
    attributeSetId: record.attributeSetId,
    version: record.version,
    grantedAttributes: granted,
    denied,
    proofIssuanceId,
  };
}

// ---------------------------------------------------------------------------
// 11. VerifyProof
// ---------------------------------------------------------------------------

export interface VerifyProofResult {
  valid: boolean;
  reason: string;
  subjectId: string;
  rootMatchesLedger: boolean;
  attributesVerified: string[];
}

/**
 * Verify a proof bundle against the root currently committed on the ledger.
 *
 * Two independent checks, and both must pass:
 *   1. Every attribute proof folds to the bundle's stated root.
 *   2. That root is the one the ledger actually holds for the subject.
 *
 * Check 2 is what stops a replayed bundle from an older version being accepted
 * as current — a bundle is evidence of attributes, never of current standing.
 */
export async function verifyProof(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
  bundle: ProofBundle,
): Promise<VerifyProofResult> {
  guard(ctx, {});

  const registry = await readJson<SubjectRegistry>(store, KEY.registry(subjectId));
  if (registry === null) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

  const record = await readJson<KYCRecord>(store, registry.currentRecordKey);
  if (record === null) fail('ERR_REGISTRY_DIVERGENCE', 'registry points at a missing record');

  const cryptoValid = verifyProofBundle(bundle);
  const rootMatchesLedger = record.merkleRoot === bundle.merkleRoot;

  let reason = 'VALID';
  if (!cryptoValid) reason = 'PROOF_VERIFICATION_FAILED';
  else if (!rootMatchesLedger) reason = 'ROOT_NOT_CURRENT';
  else if (record.status !== 'ACTIVE') reason = `RECORD_${record.status}`;

  const valid = cryptoValid && rootMatchesLedger && record.status === 'ACTIVE';

  return {
    valid,
    reason,
    subjectId,
    rootMatchesLedger,
    attributesVerified: valid ? bundle.attributes.map((a) => a.name).sort() : [],
  };
}

// ---------------------------------------------------------------------------
// Verification events (written by the orchestrator for cost instrumentation)
// ---------------------------------------------------------------------------

export async function recordVerificationEvent(
  store: StateStore,
  ctx: TxContext,
  event: Omit<VerificationEvent, 'docType' | 'createdTxId'>,
): Promise<void> {
  guard(ctx, { payload: event });
  // providerRef holds a REFERENCE, never a payload: a NADRA response contains
  // name, father's name and address, and persisting it would breach P1 in the
  // most direct way possible.
  if (event.providerRef.length > 128) {
    fail('ERR_PAYLOAD_TOO_LARGE', 'providerRef must be a reference, not a payload');
  }
  const full: VerificationEvent = { docType: 'VerificationEvent', createdTxId: ctx.txId, ...event };
  await writeJson(store, KEY.verificationEvent(event.subjectId, event.performedAt, event.eventId), full);
}

export async function getAuditTrail(
  store: StateStore,
  ctx: TxContext,
  subjectId: string,
): Promise<AuditEvent[]> {
  guard(ctx, {});
  const rows = await store.getRange(KEY.auditRangeStart(subjectId), KEY.auditRangeEnd(subjectId));
  return rows.map((r) => JSON.parse(r.value) as AuditEvent);
}
