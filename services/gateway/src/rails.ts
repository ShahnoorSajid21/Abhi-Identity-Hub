import { randomUUID } from 'node:crypto';
import type { VerificationMethod } from '@abhi/types';
import { fail } from '@abhi/types';

/**
 * Mock verification rails.
 *
 * Cost-instrumented on purpose. The single most valuable number this POC
 * produces is not a demo screen — it is the measured duplicate-verification
 * rate and the spend it implies. Every mocked call increments a counter with a
 * configurable unit cost so savings are MEASURED rather than asserted.
 *
 * Unit costs below are PLACEHOLDER GRID POINTS, not ABHI numbers. Real
 * per-call costs are [OPEN-3] and must be supplied by Finance.
 */
export interface RailCost {
  method: VerificationMethod;
  provider: string;
  unitCostPkr: number;
}

export const DEFAULT_RAIL_COSTS: Readonly<Record<VerificationMethod, RailCost>> = Object.freeze({
  ASSERTED: { method: 'ASSERTED', provider: 'NONE', unitCostPkr: 0 },
  VERISYS: { method: 'VERISYS', provider: 'NADRA_VERISYS', unitCostPkr: 25 },
  DOC_AUTH: { method: 'DOC_AUTH', provider: 'NADRA_DOC_AUTH', unitCostPkr: 15 },
  BIOMETRIC_1TO1: { method: 'BIOMETRIC_1TO1', provider: 'NADRA_BIOMETRIC', unitCostPkr: 40 },
  LIVENESS: { method: 'LIVENESS', provider: 'LIVENESS_PROVIDER', unitCostPkr: 20 },
});

/** Daily attempt cap per method, per subject, set by ABHI product policy. */
export const DAILY_ATTEMPT_CAP = 3;

export interface RailResult {
  method: VerificationMethod;
  outcome: boolean;
  provider: string;
  providerRef: string;
  costUnits: number;
  attemptNumber: number;
  latencyMs: number;
}

export interface RailMetrics {
  callsMade: number;
  callsAvoided: number;
  costSpentPkr: number;
  costAvoidedPkr: number;
  byMethod: Record<string, { made: number; avoided: number }>;
  capLockouts: number;
}

export interface RailOptions {
  costs?: Readonly<Record<VerificationMethod, RailCost>>;
  /** 0..1 — deterministic failure injection for chaos testing. */
  failureRate?: number;
  latencyMs?: number;
}

export class MockRails {
  readonly #costs: Readonly<Record<VerificationMethod, RailCost>>;
  readonly #failureRate: number;
  readonly #latencyMs: number;
  /** subjectId|method|YYYY-MM-DD -> attempts used */
  readonly #attempts = new Map<string, number>();

  #metrics: RailMetrics = {
    callsMade: 0,
    callsAvoided: 0,
    costSpentPkr: 0,
    costAvoidedPkr: 0,
    byMethod: {},
    capLockouts: 0,
  };

  constructor(opts: RailOptions = {}) {
    this.#costs = opts.costs ?? DEFAULT_RAIL_COSTS;
    this.#failureRate = opts.failureRate ?? 0;
    this.#latencyMs = opts.latencyMs ?? 0;
  }

  get metrics(): RailMetrics {
    return {
      ...this.#metrics,
      byMethod: { ...this.#metrics.byMethod },
    };
  }

  /**
   * The unit costs this instance is actually charging.
   *
   * Exposed so callers that need to price a hypothetical journey — "what would
   * this upload have cost?" — read the same table the real calls are billed
   * against. The console used to keep its own copy of these numbers, which is
   * a constant waiting to disagree with the one /metrics reports.
   */
  get costs(): Readonly<Record<VerificationMethod, RailCost>> {
    return this.#costs;
  }

  reset(): void {
    this.#metrics = {
      callsMade: 0,
      callsAvoided: 0,
      costSpentPkr: 0,
      costAvoidedPkr: 0,
      byMethod: {},
      capLockouts: 0,
    };
    this.#attempts.clear();
  }

  #bump(method: string, field: 'made' | 'avoided'): void {
    const m = (this.#metrics.byMethod[method] ??= { made: 0, avoided: 0 });
    m[field] += 1;
  }

  #capKey(subjectId: string, method: VerificationMethod, now: Date): string {
    return `${subjectId}|${method}|${now.toISOString().slice(0, 10)}`;
  }

  attemptsUsed(subjectId: string, method: VerificationMethod, now = new Date()): number {
    return this.#attempts.get(this.#capKey(subjectId, method, now)) ?? 0;
  }

  /**
   * Record that a rail call was AVOIDED because an existing verification was
   * reused. This is the measurement that makes the business case real.
   */
  recordAvoided(methods: readonly VerificationMethod[]): void {
    for (const method of methods) {
      const cost = this.#costs[method];
      this.#metrics.callsAvoided += 1;
      this.#metrics.costAvoidedPkr += cost.unitCostPkr;
      this.#bump(method, 'avoided');
    }
  }

  /**
   * Invoke a rail.
   *
   * The daily attempt cap is enforced here. In production NADRA's own counter
   * is authoritative and the two WILL drift on network timeouts — drift in one
   * direction locks out legitimate customers, in the other it wastes paid
   * calls. Daily reconciliation against NADRA is a Phase 4 requirement.
   */
  async call(
    subjectId: string,
    method: VerificationMethod,
    now = new Date(),
  ): Promise<RailResult> {
    const cost = this.#costs[method];
    const capped = method === 'BIOMETRIC_1TO1' || method === 'LIVENESS';

    if (capped) {
      const key = this.#capKey(subjectId, method, now);
      const used = this.#attempts.get(key) ?? 0;
      if (used >= DAILY_ATTEMPT_CAP) {
        this.#metrics.capLockouts += 1;
        fail(
          'ERR_ATTEMPT_CAP_EXCEEDED',
          `${method} capped at ${DAILY_ATTEMPT_CAP} attempts per day`,
        );
      }
      this.#attempts.set(key, used + 1);
    }

    if (this.#latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.#latencyMs));
    }

    const attemptNumber = capped ? this.attemptsUsed(subjectId, method, now) : 1;
    const outcome = this.#failureRate === 0 ? true : Math.random() >= this.#failureRate;

    this.#metrics.callsMade += 1;
    this.#metrics.costSpentPkr += cost.unitCostPkr;
    this.#bump(method, 'made');

    return {
      method,
      outcome,
      provider: cost.provider,
      // A reference, never a payload. A NADRA response contains name, father's
      // name and address; persisting it would breach principle P1 directly.
      providerRef: `${cost.provider}:${randomUUID().slice(0, 8)}`,
      costUnits: cost.unitCostPkr,
      attemptNumber,
      latencyMs: this.#latencyMs,
    };
  }
}

/**
 * e-CIB is a CREDIT check, not an identity check.
 *
 * It is deliberately modelled separately and is NEVER avoided by KYC reuse.
 * A verification from last year says nothing about today's credit standing,
 * and conflating the two would be the most dangerous possible misreading of
 * this design.
 */
export class MockECib {
  #calls = 0;
  /** Subjects this mock reports an adverse credit record for. */
  readonly #adverse = new Set<string>();

  get calls(): number {
    return this.#calls;
  }

  reset(): void {
    this.#calls = 0;
    this.#adverse.clear();
  }

  /**
   * Mark a subject as carrying an adverse credit record.
   *
   * The mock answered `clean: true` unconditionally, which meant the not-clean
   * branch could not be reached from a test — and the gateway was discarding
   * the answer anyway, so nothing noticed. A control whose failure path cannot
   * be exercised is a control nobody has checked.
   */
  markAdverse(subjectId: string): void {
    this.#adverse.add(subjectId);
  }

  check(subjectId: string): Promise<{ subjectId: string; clean: boolean; ref: string }> {
    this.#calls += 1;
    return Promise.resolve({
      subjectId,
      clean: !this.#adverse.has(subjectId),
      ref: `ECIB:${randomUUID().slice(0, 8)}`,
    });
  }
}
