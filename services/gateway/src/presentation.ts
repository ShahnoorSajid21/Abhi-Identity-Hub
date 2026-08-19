import { randomUUID } from 'node:crypto';
import type { DecisionOutcome, DecisionReason, VerificationMethod } from '@abhi/types';

/**
 * PRESENTATION STATE. NOT LEDGER STATE.
 * ---------------------------------------------------------------------------
 * Read this before using anything in this file as evidence of anything.
 *
 * The ledger is the source of truth for what happened to a customer's identity
 * record. This module is an INDEX OVER IT, kept so the operations screens can
 * answer two questions the ledger cannot answer cheaply:
 *
 *   1. "What has a product recently asked us about?"  → the verification queue
 *   2. "What happened across all customers today?"    → the global audit feed
 *
 * The ledger's own audit trail (AEVT~ keys, GetAuditTrail) is per-subject and
 * is the authoritative record. Nothing here is authoritative, nothing here is
 * signed, and nothing here survives a restart. If this index and the ledger
 * ever disagree, the ledger is right and this is a bug.
 *
 * It is in-process rather than in Postgres deliberately: the POC has no
 * database running by default, and one fewer moving part on demo day is worth
 * more than durability that nothing depends on. `npm run demo:seed` against a
 * restarted gateway is the reset.
 */

export interface QueueRequest {
  requestId: string;
  subjectId: string;
  productId: string;
  requestedAt: string;
  decision: DecisionOutcome;
  decisionReason: DecisionReason;
  /** Checks this product still needs. Empty unless the decision is STEP_UP. */
  missingMethods: VerificationMethod[];
  currentAssurance: string | null;
  requiredAssurance: string;
  ageDays: number | null;
  policyId: string;
  railCallsAvoided: number;
  costAvoidedPkr: number;
  disclosedAttributes: string[];
  /** Set once the request has been acted on, so the queue can drain. */
  resolvedAt: string | null;
}

export interface ActivityEntry {
  at: string;
  actorMsp: string;
  actorRole: string | null;
  /** A stable key the UI maps to a plain sentence. */
  action:
    | 'IDENTITY_CONFIRMED'
    | 'IDENTITY_UPDATED'
    | 'VERIFICATION'
    | 'FROZEN'
    | 'REINSTATED'
    | 'ERASED'
    | 'CONSENT_GRANTED'
    | 'CONSENT_REVOKED';
  subjectId: string;
  productId: string | null;
  decision: DecisionOutcome | null;
  detail: string | null;
}

/** Newest first, capped so a long-running gateway cannot grow without bound. */
const MAX_ENTRIES = 5000;

export class PresentationStore {
  readonly #queue: QueueRequest[] = [];
  readonly #activity: ActivityEntry[] = [];

  recordVerification(input: Omit<QueueRequest, 'requestId' | 'resolvedAt'>): QueueRequest {
    const request: QueueRequest = {
      ...input,
      requestId: randomUUID(),
      resolvedAt: null,
    };
    this.#queue.unshift(request);
    if (this.#queue.length > MAX_ENTRIES) this.#queue.length = MAX_ENTRIES;
    return request;
  }

  recordActivity(entry: ActivityEntry): void {
    this.#activity.unshift(entry);
    if (this.#activity.length > MAX_ENTRIES) this.#activity.length = MAX_ENTRIES;
  }

  /**
   * The queue, newest first.
   *
   * A subject may appear more than once — a product can ask about the same
   * customer twice, and hiding the second ask would misrepresent what the
   * operations team is looking at.
   */
  queue(filter: { decision?: string; productId?: string; includeResolved?: boolean } = {}): QueueRequest[] {
    return this.#queue.filter((r) => {
      if (filter.includeResolved !== true && r.resolvedAt !== null) return false;
      if (filter.decision !== undefined && r.decision !== filter.decision) return false;
      if (filter.productId !== undefined && r.productId !== filter.productId) return false;
      return true;
    });
  }

  request(requestId: string): QueueRequest | null {
    return this.#queue.find((r) => r.requestId === requestId) ?? null;
  }

  resolve(requestId: string, at: string): boolean {
    const request = this.#queue.find((r) => r.requestId === requestId);
    if (request === undefined) return false;
    request.resolvedAt = at;
    return true;
  }

  activity(filter: { subjectId?: string; action?: string; since?: string } = {}): ActivityEntry[] {
    return this.#activity.filter((e) => {
      if (filter.subjectId !== undefined && e.subjectId !== filter.subjectId) return false;
      if (filter.action !== undefined && e.action !== filter.action) return false;
      if (filter.since !== undefined && e.at < filter.since) return false;
      return true;
    });
  }

  /**
   * Verification counts per day, newest bucket last.
   *
   * Bucketed HERE rather than in the browser, deliberately. The client could
   * page /audit and count what came back, but that feed is capped per request:
   * a truncated page silently undercounts the OLDEST days, producing a chart
   * that slopes downward as an artefact of pagination rather than because
   * activity fell. Aggregating over the whole retained index removes that
   * class of lie entirely.
   *
   * `complete` is the honest half. This store keeps at most MAX_ENTRIES, so a
   * busy gateway can evict events that fall inside the requested window. When
   * that has happened the earliest buckets are undercounts, and the caller is
   * told so rather than left to trust the bars.
   */
  dailyActivity(
    days: number,
    now: Date,
  ): { buckets: { date: string; verifications: number; reused: number }[]; complete: boolean } {
    const span = Math.max(1, Math.min(days, 90));

    // Local calendar days, not UTC: "today" has to mean the operator's today.
    const key = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (span - 1));

    const buckets = new Map<string, { date: string; verifications: number; reused: number }>();
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      buckets.set(key(d), { date: key(d), verifications: 0, reused: 0 });
    }

    for (const e of this.#activity) {
      if (e.action !== 'VERIFICATION') continue;
      const at = new Date(e.at);
      if (Number.isNaN(at.getTime()) || at < start) continue;
      const bucket = buckets.get(key(at));
      if (bucket === undefined) continue;
      bucket.verifications += 1;
      if (e.decision === 'ALLOW') bucket.reused += 1;
    }

    // At capacity the oldest retained event bounds what can be counted. If it
    // is newer than the window start, the earliest buckets are incomplete.
    const oldest = this.#activity[this.#activity.length - 1];
    const complete =
      this.#activity.length < MAX_ENTRIES ||
      oldest === undefined ||
      new Date(oldest.at) <= start;

    return { buckets: [...buckets.values()], complete };
  }

  /** Counts for the queue tabs, computed once rather than per tab. */
  queueCounts(): Record<DecisionOutcome, number> {
    const counts: Record<DecisionOutcome, number> = {
      ALLOW: 0,
      STEP_UP: 0,
      FULL_KYC: 0,
      DENY: 0,
    };
    for (const r of this.queue()) counts[r.decision] += 1;
    return counts;
  }

  reset(): void {
    this.#queue.length = 0;
    this.#activity.length = 0;
  }
}
