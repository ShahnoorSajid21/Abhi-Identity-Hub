import { padVersion } from '@abhi/canonical';

/**
 * State abstraction.
 *
 * The chaincode domain logic is written against this port rather than against
 * Fabric's ChaincodeStub directly. Two implementations exist:
 *
 *   - FabricStateStore  (src/fabric-adapter.ts) — the real thing
 *   - MemoryStateStore  (src/memory-state.ts)   — tests, and the gateway's
 *                                                 simulator mode
 *
 * This is not a testing convenience bolted on afterwards. It is what allows
 * every business rule below to be exhaustively unit-tested without standing up
 * a five-container network, and it keeps Fabric-specific concerns confined to
 * one adapter file.
 */
export interface StateStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Inclusive-exclusive range scan, ascending by key. */
  getRange(startKey: string, endKey: string): Promise<{ key: string; value: string }[]>;
}

/** Transaction context — the subset of Fabric's context the domain needs. */
export interface TxContext {
  mspId: string;
  /** Value of the `kyc.role` certificate attribute, if present. */
  role: string | null;
  txId: string;
  /** Transaction timestamp. NEVER a client clock — see note below. */
  timestamp: Date;
  /** Emits a chaincode event. */
  setEvent(name: string, payload: unknown): void;
  /**
   * Monotonic ordinal WITHIN this transaction, starting at 1.
   *
   * Every endorsing peer executes the same transaction independently and their
   * read-write sets must match byte-for-byte. A module-level counter would
   * therefore diverge across peers — peer A on its 40th invocation and peer B
   * on its 3rd would generate different keys for the same logical event,
   * producing an endorsement mismatch that surfaces as an intermittent
   * "network" fault.
   *
   * Resetting per transaction is what makes generated identifiers deterministic.
   * (Finding SEC-11.)
   */
  nextOrdinal(): number;
}

/**
 * Composite key builders.
 *
 * Zero-padding the version is not cosmetic: without it `KYC~S~10` sorts before
 * `KYC~S~2`, and GetVersionChain silently returns versions out of order,
 * producing a chain that fails hash verification for reasons that take a day
 * to find.
 */
export const KEY = {
  kycRecord: (subjectId: string, version: number): string =>
    `KYC~${subjectId}~${padVersion(version)}`,
  kycRangeStart: (subjectId: string): string => `KYC~${subjectId}~`,
  // '~' is 0x7E; '\x7F' is the next code point, giving a clean exclusive upper bound.
  kycRangeEnd: (subjectId: string): string => `KYC~${subjectId}~\x7F`,

  registry: (subjectId: string): string => `SUBJ~${subjectId}`,

  consent: (subjectId: string, grantedTo: string, consentId: string): string =>
    `CONS~${subjectId}~${grantedTo}~${consentId}`,
  consentRangeStart: (subjectId: string): string => `CONS~${subjectId}~`,
  consentRangeEnd: (subjectId: string): string => `CONS~${subjectId}~\x7F`,

  verificationEvent: (subjectId: string, ts: string, eventId: string): string =>
    `VEVT~${subjectId}~${ts}~${eventId}`,

  auditEvent: (subjectId: string, ts: string, eventId: string): string =>
    `AEVT~${subjectId}~${ts}~${eventId}`,
  auditRangeStart: (subjectId: string): string => `AEVT~${subjectId}~`,
  auditRangeEnd: (subjectId: string): string => `AEVT~${subjectId}~\x7F`,

  productPolicy: (productId: string, policyVersion: number): string =>
    `POL~${productId}~${String(policyVersion).padStart(4, '0')}`,
} as const;
