import {
  MemoryStateStore,
  KEY,
  registerKYC,
  verifyKYC,
  updateKYC,
  suspendKYC,
  reinstateKYC,
  recordConsent,
  revokeConsent,
  markShredded,
  getVersionChain,
  generateProof,
  verifyProof,
  getAuditTrail,
  type StateStore,
  type TxContext,
  type RegisterKYCInput,
  type UpdateKYCInput,
  type RecordConsentInput,
} from '@abhi/kyc-registry';
import type { ProofBundle } from '@abhi/merkle';
import type {
  AssuranceLevel,
  ConsentRecord,
  KYCRecord,
  ProductPolicy,
  RecordStatus,
  SubjectRegistry,
  VerificationMethod,
} from '@abhi/types';

/**
 * One subject, flattened for the customer directory.
 *
 * Ledger-sourced only. There is no name here and there never will be — the
 * display fields are composed at the edge from core banking (see cbs.ts).
 */
export interface SubjectSummary {
  subjectId: string;
  status: RecordStatus;
  currentVersion: number;
  versionCount: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  verifiedAt: string;
  expiresAt: string;
  cnicExpiryAt: string;
  merkleRoot: string;
}

/**
 * Ledger port.
 *
 * Two adapters:
 *   SimulatedLedger — runs the real chaincode domain logic against an
 *                     in-memory state store. Used for tests, CI and the
 *                     laptop demo.
 *   FabricLedger    — the Fabric Gateway SDK client (network/ + fabric-adapter).
 *
 * The distinction that matters: the SIMULATOR RUNS THE SAME BUSINESS LOGIC as
 * the chaincode — same validation, same state machine, same hash chaining. It
 * does NOT provide endorsement, ordering, or independent peers, and therefore
 * provides none of the governance properties that justify the ledger. It is a
 * development and demonstration tool, and the gateway refuses to boot in
 * simulator mode when NODE_ENV=production.
 */
export interface LedgerPort {
  readonly mode: 'simulated' | 'fabric';
  register(ctx: TxContext, input: RegisterKYCInput): Promise<{ version: number; recordHash: string }>;
  verify(ctx: TxContext, subjectId: string): ReturnType<typeof verifyKYC>;
  update(ctx: TxContext, input: UpdateKYCInput): ReturnType<typeof updateKYC>;
  suspend(ctx: TxContext, subjectId: string, reason: string, ref: string): ReturnType<typeof suspendKYC>;
  reinstate(ctx: TxContext, subjectId: string, reason: string, ref: string): ReturnType<typeof reinstateKYC>;
  consent(
    ctx: TxContext,
    input: RecordConsentInput,
    known: readonly string[],
    maxScope?: readonly string[],
  ): ReturnType<typeof recordConsent>;
  revoke(ctx: TxContext, subjectId: string, grantedTo: string, consentId: string, reason: string): ReturnType<typeof revokeConsent>;
  shred(ctx: TxContext, subjectId: string, reason: string, basis: string, cert: string): ReturnType<typeof markShredded>;
  chain(ctx: TxContext, subjectId: string): ReturnType<typeof getVersionChain>;
  authoriseProof(
    ctx: TxContext,
    subjectId: string,
    productId: string,
    requested: readonly string[],
    consentId: string,
    policy: ProductPolicy,
  ): ReturnType<typeof generateProof>;
  checkProof(ctx: TxContext, subjectId: string, bundle: ProofBundle): ReturnType<typeof verifyProof>;
  audit(ctx: TxContext, subjectId: string): ReturnType<typeof getAuditTrail>;

  /**
   * Enumerate every subject, for the customer directory.
   *
   * OPTIONAL, and deliberately so. The simulator can range-scan its own state
   * store cheaply. Fabric cannot: an unbounded range query across a channel is
   * a rich-query against CouchDB with no pagination and no access control on
   * the result set, and building the directory that way would be a mistake
   * that only shows up under load. The production answer is a chaincode query
   * with an explicit page cursor, which does not exist yet — so FabricLedger
   * does not implement this, and the directory endpoints say so plainly rather
   * than pretending.
   */
  listSubjects?(): Promise<SubjectSummary[]>;

  /**
   * A subject's consent grants. Optional for the same reason as listSubjects.
   *
   * Consent is recorded and revoked through the chaincode already; only
   * reading the list back has no function, because nothing on the write path
   * ever needed to enumerate them.
   */
  listConsents?(subjectId: string): Promise<ConsentRecord[]>;
}

export class SimulatedLedger implements LedgerPort {
  readonly mode = 'simulated' as const;
  readonly store: StateStore;

  constructor(store: StateStore = new MemoryStateStore()) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'FATAL: SimulatedLedger provides no endorsement, ordering or independent peers. ' +
          'It must never run in production — configure the Fabric adapter.',
      );
    }
    this.store = store;
  }

  async register(ctx: TxContext, input: RegisterKYCInput) {
    const r = await registerKYC(this.store, ctx, input);
    return { version: r.version, recordHash: r.recordHash };
  }
  verify(ctx: TxContext, subjectId: string) {
    return verifyKYC(this.store, ctx, subjectId);
  }
  update(ctx: TxContext, input: UpdateKYCInput) {
    return updateKYC(this.store, ctx, input);
  }
  suspend(ctx: TxContext, subjectId: string, reason: string, ref: string) {
    return suspendKYC(this.store, ctx, subjectId, reason, ref);
  }
  reinstate(ctx: TxContext, subjectId: string, reason: string, ref: string) {
    return reinstateKYC(this.store, ctx, subjectId, reason, ref);
  }
  consent(
    ctx: TxContext,
    input: RecordConsentInput,
    known: readonly string[],
    maxScope?: readonly string[],
  ) {
    return recordConsent(this.store, ctx, input, known, maxScope);
  }
  revoke(ctx: TxContext, subjectId: string, grantedTo: string, consentId: string, reason: string) {
    return revokeConsent(this.store, ctx, subjectId, grantedTo, consentId, reason);
  }
  shred(ctx: TxContext, subjectId: string, reason: string, basis: string, cert: string) {
    return markShredded(this.store, ctx, subjectId, reason, basis, cert);
  }
  chain(ctx: TxContext, subjectId: string) {
    return getVersionChain(this.store, ctx, subjectId);
  }
  authoriseProof(
    ctx: TxContext,
    subjectId: string,
    productId: string,
    requested: readonly string[],
    consentId: string,
    policy: ProductPolicy,
  ) {
    return generateProof(this.store, ctx, subjectId, productId, requested, consentId, policy);
  }
  checkProof(ctx: TxContext, subjectId: string, bundle: ProofBundle) {
    return verifyProof(this.store, ctx, subjectId, bundle);
  }
  audit(ctx: TxContext, subjectId: string) {
    return getAuditTrail(this.store, ctx, subjectId);
  }

  /**
   * Range-scan the subject registry, then read each subject's current record.
   *
   * Two passes rather than one, because the registry row carries the status
   * and version but not the assurance level — that lives on the versioned
   * record the registry points at.
   */
  async listSubjects(): Promise<SubjectSummary[]> {
    const rows = await this.store.getRange('SUBJ~', 'SUBJ~\x7F');
    const out: SubjectSummary[] = [];

    for (const row of rows) {
      const registry = JSON.parse(row.value) as SubjectRegistry;
      const recordRaw = await this.store.get(
        KEY.kycRecord(registry.subjectId, registry.currentVersion),
      );
      // A registry entry whose record is missing is a corrupt state, not an
      // empty one. Skipping it keeps the directory readable; the conformance
      // audit is the place that should complain about it.
      if (recordRaw === null) continue;
      const record = JSON.parse(recordRaw) as KYCRecord;

      out.push({
        subjectId: registry.subjectId,
        status: registry.status,
        currentVersion: registry.currentVersion,
        versionCount: registry.versionCount,
        firstSeenAt: registry.firstSeenAt,
        lastUpdatedAt: registry.lastUpdatedAt,
        assuranceLevel: record.assuranceLevel,
        methods: record.methods,
        verifiedAt: record.verifiedAt,
        expiresAt: record.expiresAt,
        cnicExpiryAt: record.cnicExpiryAt,
        merkleRoot: record.merkleRoot,
      });
    }

    return out;
  }

  async listConsents(subjectId: string): Promise<ConsentRecord[]> {
    const rows = await this.store.getRange(
      KEY.consentRangeStart(subjectId),
      KEY.consentRangeEnd(subjectId),
    );
    return rows.map((r) => JSON.parse(r.value) as ConsentRecord);
  }
}
