import {
  rankOf,
  REQUIRED_METHODS,
  type AssuranceLevel,
  type DecisionOutcome,
  type DecisionReason,
  type KYCRecord,
  type ProductPolicy,
  type VerificationMethod,
} from '@abhi/types';

export interface Decision {
  outcome: DecisionOutcome;
  reason: DecisionReason;
  /** Methods the product must run. Empty for ALLOW and DENY. */
  missingMethods: VerificationMethod[];
  /** Populated for ALLOW — the attributes this product may receive. */
  disclosableAttributes: string[];
  ageDays: number | null;
  currentAssurance: AssuranceLevel | null;
  requiredAssurance: AssuranceLevel;
  policyId: string;
}

/** Strongest method present on a record, for staleness re-affirmation. */
export function strongestMethod(methods: readonly VerificationMethod[]): VerificationMethod {
  const order: VerificationMethod[] = ['LIVENESS', 'BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS', 'ASSERTED'];
  for (const m of order) if (methods.includes(m)) return m;
  return 'ASSERTED';
}

/**
 * Methods needed to move from what a record has to what a product requires.
 *
 * This is where most of the practical value of the whole system sits: today an
 * A2 customer applying for SBL repeats the entire onboarding pack. Here the
 * answer is ['LIVENESS'] — one selfie.
 */
export function missingMethodsFor(
  record: Pick<KYCRecord, 'methods'> | null,
  required: AssuranceLevel,
): VerificationMethod[] {
  const have = new Set<VerificationMethod>(record?.methods ?? []);
  return REQUIRED_METHODS[required].filter((m) => !have.has(m));
}

export function ageDaysBetween(fromIso: string, now: Date): number {
  const ms = now.getTime() - Date.parse(fromIso);
  return Math.floor(ms / 86_400_000);
}

/**
 * The decision engine.
 *
 * Pure and side-effect-free: given the same (record, policy, now) it must
 * always return the same output. That is what makes it exhaustively testable
 * and what lets an auditor re-run a historical decision against the policy
 * version that was in force at the time.
 *
 * Ordering is deliberate and each rule's position is load-bearing:
 *
 *   1. No record        -> FULL_KYC
 *   2. SUSPENDED        -> DENY      (outranks everything; a frozen subject is
 *                                     denied before any other consideration)
 *   3. SHREDDED         -> FULL_KYC  (not DENY: the vault data is gone so no
 *                                     proof can be built, but the customer is
 *                                     not barred — they re-onboard)
 *   4. CNIC expired     -> DENY      (hard stop, never STEP_UP: no amount of
 *                                     re-scanning fixes an expired document)
 *   5. Assurance too low-> STEP_UP   (before staleness, because satisfying the
 *                                     assurance gap also refreshes the age)
 *   6. Too old          -> STEP_UP   (re-affirm strongest method only)
 *   7. otherwise        -> ALLOW
 */
export function decide(
  record: KYCRecord | null,
  policy: ProductPolicy,
  now: Date,
): Decision {
  const pid = `${policy.productId}@v${policy.policyVersion}`;

  const base = {
    missingMethods: [] as VerificationMethod[],
    disclosableAttributes: [] as string[],
    ageDays: null as number | null,
    currentAssurance: record?.assuranceLevel ?? null,
    requiredAssurance: policy.minAssurance,
    policyId: pid,
  };

  if (record === null) {
    return {
      ...base,
      outcome: 'FULL_KYC',
      reason: 'NO_RECORD',
      missingMethods: [...REQUIRED_METHODS[policy.minAssurance]],
    };
  }

  const ageDays = ageDaysBetween(record.verifiedAt, now);

  if (record.status === 'SUSPENDED') {
    return { ...base, outcome: 'DENY', reason: 'SUSPENDED', ageDays };
  }

  if (record.status === 'SHREDDED') {
    return {
      ...base,
      outcome: 'FULL_KYC',
      reason: 'SHREDDED',
      ageDays,
      missingMethods: [...REQUIRED_METHODS[policy.minAssurance]],
    };
  }

  if (policy.denyOnCnicExpiry && Date.parse(record.cnicExpiryAt) <= now.getTime()) {
    return { ...base, outcome: 'DENY', reason: 'CNIC_EXPIRED', ageDays };
  }

  if (rankOf(record.assuranceLevel) < rankOf(policy.minAssurance)) {
    return {
      ...base,
      outcome: 'STEP_UP',
      reason: 'ASSURANCE_LOW',
      ageDays,
      missingMethods: missingMethodsFor(record, policy.minAssurance),
    };
  }

  if (ageDays > policy.maxAgeDays) {
    return {
      ...base,
      outcome: 'STEP_UP',
      reason: 'STALE',
      ageDays,
      missingMethods: [strongestMethod(record.methods)],
    };
  }

  return {
    ...base,
    outcome: 'ALLOW',
    reason: 'SUFFICIENT',
    ageDays,
    disclosableAttributes: [...policy.disclosableAttributes],
  };
}

/**
 * Least disclosure (P4) as one function: the three-way intersection of what
 * was requested, what the customer consented to, and what the product's policy
 * permits. The narrowest always wins.
 */
export function intersectDisclosure(
  requested: readonly string[],
  consentScope: readonly string[],
  policyAttributes: readonly string[],
): { granted: string[]; denied: string[] } {
  const consent = new Set(consentScope);
  const allowed = new Set(policyAttributes);
  const granted: string[] = [];
  const denied: string[] = [];

  for (const attr of requested) {
    if (consent.has(attr) && allowed.has(attr)) granted.push(attr);
    else denied.push(attr);
  }
  return { granted: granted.sort(), denied: denied.sort() };
}
