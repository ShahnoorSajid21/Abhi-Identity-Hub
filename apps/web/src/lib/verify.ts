/**
 * Step-up routing.
 *
 * The gateway answers "can this customer proceed?" with one of four outcomes.
 * This module turns that answer into the single next screen the customer
 * should see — and, critically, into a decision to SKIP the screens they have
 * already satisfied.
 *
 * The routing is a pure function, deliberately. Rendering the right component
 * is a React concern; deciding which one is right is a compliance concern, and
 * separating them means the rule can be exhaustively tested without a DOM and
 * re-read by a reviewer who does not write React.
 */

import { request, type DecisionOutcome, type DecisionReason, type VerificationMethod } from './api.ts';

export interface VerifyDecision {
  outcome: DecisionOutcome;
  reason: DecisionReason;
  /** Methods this product still needs. Empty for ALLOW and DENY. */
  missingMethods: VerificationMethod[];
  /** Populated for ALLOW — what this product is entitled to see. */
  disclosableAttributes: string[];
  ageDays: number | null;
  currentAssurance: string | null;
  requiredAssurance: string;
  policyId: string;
}

export interface AttributeProof {
  name: string;
  canonical: string;
  salt: string;
  path: { hash: string; side: 'left' | 'right' }[];
}

export interface ProofBundle {
  merkleRoot: string;
  attributeSetId: string;
  attributes: AttributeProof[];
}

export interface VerifyResult {
  subjectId: string;
  decision: VerifyDecision;
  proof: ProofBundle | null;
  railCallsAvoided: number;
  costAvoidedPkr: number;
  /** Always true except on DENY. The credit check is never displaced by reuse. */
  eCibCalled: boolean;
}

/**
 * VerifyKYC.
 *
 * Accepts a subjectId OR a cnic. The console holds subject ids and never a
 * CNIC; a customer-facing journey that has just captured the card holds the
 * CNIC and no subject id. The gateway derives the subject id from a CNIC
 * inside the HSM boundary, so only one of the two is ever needed.
 */
export function verifyKyc(input: {
  subjectId?: string;
  cnic?: string;
  productId: string;
  consentId?: string | null;
  requestedAttributes?: string[];
}): Promise<VerifyResult> {
  if (input.subjectId === undefined && input.cnic === undefined) {
    throw new Error('verifyKyc needs either a subjectId or a cnic');
  }
  return request<VerifyResult>('POST', '/kyc/verify', input);
}

/* ------------------------------------------------------------------ */
/* The routing rule                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every screen the journey can land on.
 *
 * `review` is the product's own review screen — the destination when nothing
 * further is required.
 */
export type StepScreen =
  | 'review'
  | 'nadra-check'
  | 'document-capture'
  | 'fingerprint-capture'
  | 'liveness-capture'
  | 'full-onboarding'
  | 'hard-stop';

export interface NextStep {
  screen: StepScreen;
  /** The method this screen satisfies. Null for review, onboarding, hard stop. */
  method: VerificationMethod | null;
  /** Methods still outstanding AFTER this screen — drives the progress line. */
  remaining: VerificationMethod[];
  /** Methods deliberately NOT shown because the ledger already holds them. */
  skipped: VerificationMethod[];
}

/**
 * One screen per verification method.
 *
 * Exhaustive by construction: adding a VerificationMethod without a screen is
 * a TypeScript error, not a runtime fallthrough that silently skips a check.
 */
const SCREEN_FOR: Record<VerificationMethod, StepScreen> = {
  ASSERTED: 'full-onboarding',
  VERISYS: 'nadra-check',
  DOC_AUTH: 'document-capture',
  BIOMETRIC_1TO1: 'fingerprint-capture',
  LIVENESS: 'liveness-capture',
};

/**
 * The order checks are run in, strongest last.
 *
 * The gateway already returns missingMethods in this order, but relying on
 * that would make the frontend silently wrong if the engine's filter order
 * ever changed. Sorting here costs nothing and makes the contract explicit.
 */
const METHOD_ORDER: VerificationMethod[] = [
  'ASSERTED',
  'VERISYS',
  'DOC_AUTH',
  'BIOMETRIC_1TO1',
  'LIVENESS',
];

/** Full method pack for each assurance level — used to compute what was skipped. */
const PACK_FOR: Record<string, VerificationMethod[]> = {
  A0: ['ASSERTED'],
  A1: ['VERISYS', 'DOC_AUTH'],
  A2: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'],
  A3: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1', 'LIVENESS'],
};

export function sortMethods(methods: readonly VerificationMethod[]): VerificationMethod[] {
  return [...methods].sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b));
}

/**
 * Turn a decision into the next screen.
 *
 * The STEP_UP branch is the one that matters: it routes to the FIRST missing
 * method and nothing else. An A2 customer applying for SBL sees the selfie
 * screen — not the fingerprint scanner they already passed, and not a
 * re-onboarding. That skip is the entire commercial premise of the ledger, so
 * `skipped` is returned explicitly rather than left implicit, and the UI shows
 * it to the customer.
 */
export function nextStepFor(decision: VerifyDecision): NextStep {
  const missing = sortMethods(decision.missingMethods);

  switch (decision.outcome) {
    case 'ALLOW':
      return { screen: 'review', method: null, remaining: [], skipped: [] };

    case 'DENY':
      // Never a capture screen. A suspended subject or an expired CNIC cannot
      // be resolved by anything the customer does in this app.
      return { screen: 'hard-stop', method: null, remaining: [], skipped: [] };

    case 'FULL_KYC':
      return { screen: 'full-onboarding', method: null, remaining: missing, skipped: [] };

    case 'STEP_UP': {
      // A STEP_UP with no named method is a gateway defect. Failing to the
      // full journey is the safe direction: it over-verifies rather than
      // letting somebody through unchecked.
      if (missing.length === 0) {
        return { screen: 'full-onboarding', method: null, remaining: [], skipped: [] };
      }
      const [first, ...rest] = missing;
      const pack = PACK_FOR[decision.requiredAssurance] ?? [];
      return {
        screen: SCREEN_FOR[first!],
        method: first!,
        remaining: rest,
        skipped: pack.filter((m) => !missing.includes(m)),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Attempt cap                                                         */
/* ------------------------------------------------------------------ */

/**
 * Biometric and liveness are capped at three attempts per subject per day.
 *
 * The gateway enforces this and is the authority — it returns
 * ERR_ATTEMPT_CAP_EXCEEDED (429) and that is what actually protects NADRA's
 * rate limits. The client-side counter exists so a customer on their third
 * attempt is warned BEFORE burning it, and so a locked-out customer sees an
 * explanation instead of a generic error. It is a courtesy, never a control:
 * clearing browser storage resets this counter and changes nothing about what
 * the gateway will allow.
 */
export const DAILY_ATTEMPT_CAP = 3;

export const CAPPED_METHODS: readonly VerificationMethod[] = ['BIOMETRIC_1TO1', 'LIVENESS'];

export function isCapped(method: VerificationMethod): boolean {
  return CAPPED_METHODS.includes(method);
}

/** Local day, not UTC — the cap resets at the customer's midnight. */
function dayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function storageKey(subjectId: string, method: VerificationMethod, now: Date): string {
  return `abhi.attempts.${dayKey(now)}.${subjectId}.${method}`;
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Private browsing and some embedded webviews throw on access rather than
    // returning null. The journey must still work; it just loses the warning.
    return null;
  }
}

export function attemptsUsed(
  subjectId: string,
  method: VerificationMethod,
  now: Date = new Date(),
): number {
  const s = store();
  if (s === null) return 0;
  const raw = s.getItem(storageKey(subjectId, method, now));
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function attemptsRemaining(
  subjectId: string,
  method: VerificationMethod,
  now: Date = new Date(),
): number {
  if (!isCapped(method)) return Number.POSITIVE_INFINITY;
  return Math.max(0, DAILY_ATTEMPT_CAP - attemptsUsed(subjectId, method, now));
}

export function recordAttempt(
  subjectId: string,
  method: VerificationMethod,
  now: Date = new Date(),
): number {
  if (!isCapped(method)) return 0;
  const s = store();
  const used = attemptsUsed(subjectId, method, now) + 1;
  if (s !== null) s.setItem(storageKey(subjectId, method, now), String(used));
  return used;
}

export function isLockedOut(
  subjectId: string,
  method: VerificationMethod,
  now: Date = new Date(),
): boolean {
  return attemptsRemaining(subjectId, method, now) <= 0;
}
