import { daysSince } from './format.ts';
import { LEVELS } from '../copy/strings.ts';
import type { AssuranceLevel, CustomerRecord, VerificationMethod } from './api.ts';

/**
 * What each product would decide for a customer right now, and what running
 * the checks they are missing would actually do.
 *
 * A PREVIEW, computed from the same inputs the gateway's engine uses. The
 * server remains authoritative — nothing here writes, and nothing here claims
 * a verification has run. It exists so a screen can answer "what does each
 * product see?" and "what would this button actually do?" without firing four
 * real verifications to find out.
 *
 * This lived inside CustomerProfilePage until the profile's action buttons
 * needed the same answers. Two copies of a rule Compliance signed off is one
 * copy too many.
 */

const RANK: Record<AssuranceLevel, number> = { A0: 0, A1: 1, A2: 2, A3: 3 };

/**
 * Mirrors REQUIRED_METHODS in packages/types and the filter in the gateway's
 * stepUpBySubject. The console is built standalone and shares no code with the
 * gateway, so this is a copy — kept honest by the fact that it only ever
 * previews a button label, and the server decides what actually runs.
 */
const REQUIRED_METHODS: Record<AssuranceLevel, readonly VerificationMethod[]> = {
  A0: ['ASSERTED'],
  A1: ['VERISYS', 'DOC_AUTH'],
  A2: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'],
  A3: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1', 'LIVENESS'],
};

/** Mirrors methodToAttribute in the gateway service. */
const METHOD_ATTRIBUTE: Record<Exclude<VerificationMethod, 'ASSERTED'>, string> = {
  VERISYS: 'verisys_match',
  DOC_AUTH: 'document_authenticity_pass',
  BIOMETRIC_1TO1: 'biometric_match',
  LIVENESS: 'liveness_pass',
};

export type Outcome = 'ALLOW' | 'STEP_UP' | 'FULL_KYC' | 'DENY';

/** The two policy fields a decision turns on. */
export interface PolicyShape {
  minAssurance: AssuranceLevel;
  maxAgeDays: number;
}

export function previewDecision(
  record: CustomerRecord,
  policy: PolicyShape,
  now: Date,
): { outcome: Outcome; why: string } {
  if (!record.found || record.assuranceLevel === null) {
    return { outcome: 'FULL_KYC', why: 'No confirmed identity yet.' };
  }
  if (record.status === 'SUSPENDED') {
    return { outcome: 'DENY', why: 'Frozen by Compliance.' };
  }
  if (record.status === 'SHREDDED') {
    return { outcome: 'DENY', why: 'Personal details were erased at the customer’s request.' };
  }
  if (record.cnicExpiryAt !== null && new Date(record.cnicExpiryAt) < now) {
    return { outcome: 'DENY', why: 'Their CNIC has expired. They must renew it with NADRA.' };
  }

  const age = daysSince(record.verifiedAt, now);
  if (RANK[record.assuranceLevel] < RANK[policy.minAssurance]) {
    return {
      outcome: 'STEP_UP',
      why: `Needs ${LEVELS[policy.minAssurance].label.toLowerCase()}.`,
    };
  }
  if (age !== null && age > policy.maxAgeDays) {
    return {
      outcome: 'STEP_UP',
      why: `Confirmed ${age} days ago; this product accepts up to ${policy.maxAgeDays}.`,
    };
  }
  return { outcome: 'ALLOW', why: 'Already confirmed to the standard this product needs.' };
}

/**
 * The checks a step-up for this product would actually run.
 *
 * The gateway computes exactly this — required methods for the product's
 * minimum, minus the ones already on the record — and runs only what is left.
 * Reproducing it here is what lets the button say "Run 1 check" instead of
 * asking an operator to press it to find out.
 *
 * Empty does NOT mean the step-up is pointless: a record that is stale rather
 * than under-verified has nothing missing, and the update refreshes its date.
 */
export function missingMethods(record: CustomerRecord, policy: PolicyShape): VerificationMethod[] {
  const have = new Set(record.methods);
  return REQUIRED_METHODS[policy.minAssurance].filter((m) => !have.has(m));
}

/** True for the four levels the ledger recognises, so a bad string cannot silently pick a method pack. */
export function isAssuranceLevel(value: string): value is AssuranceLevel {
  return value === 'A0' || value === 'A1' || value === 'A2' || value === 'A3';
}

/**
 * The outcome attributes a step-up should commit for a target level.
 *
 * True for every method already on the record, plus every method the target
 * level requires. Two things follow from deriving it rather than hardcoding it
 * per product: the liveness flag stops being a hardcoded list of the two A3
 * products that would silently drift the day a policy changed, and an A3
 * customer stepping up for an A2 product no longer has `liveness_pass: false`
 * written against a record whose methods still include LIVENESS.
 *
 * Keyed on the level rather than a whole policy because the caller is now the
 * customer app committing a step-up the customer has just finished, and the
 * level it is stepping to is the one thing the verify result already told it —
 * `decision.requiredAssurance`. Asking it to fetch the policy table as well,
 * to read one field off it, would be a round trip for nothing.
 */
export function stepUpAttributes(
  record: Pick<CustomerRecord, 'methods'>,
  minAssurance: AssuranceLevel,
): Record<string, boolean> {
  const confirmed = new Set<VerificationMethod>([
    ...record.methods,
    ...REQUIRED_METHODS[minAssurance],
  ]);
  const attributes: Record<string, boolean> = {};
  for (const [method, attribute] of Object.entries(METHOD_ATTRIBUTE)) {
    attributes[attribute] = confirmed.has(method as VerificationMethod);
  }
  return attributes;
}

export const OUTCOME_CHIP: Record<Outcome, string> = {
  ALLOW: 'bg-ok-bg text-ok-fg',
  STEP_UP: 'bg-warn-bg text-warn-fg',
  FULL_KYC: 'bg-new-bg text-new-fg',
  DENY: 'bg-stop-bg text-stop-fg',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  ALLOW: 'Ready to proceed',
  STEP_UP: 'One more check needed',
  FULL_KYC: 'Full onboarding',
  DENY: 'Cannot proceed',
};
