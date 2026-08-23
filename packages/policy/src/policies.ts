import type { ProductPolicy } from '@abhi/types';

/**
 * Product policies as configured for the POC.
 *
 * IMPORTANT — these are ENGINEERING DEFAULTS drawn from the Consolidated
 * Product Manual v2. They are NOT Compliance-approved policy. Sign-off by
 * Compliance and Risk is a Phase 1 exit gate before any production use, and
 * the A0-A3 to SBP account-category mapping [OPEN-A] must be settled first.
 *
 * Policy lives here, in the gateway, rather than in chaincode: product
 * requirements change quarterly, and a chaincode upgrade needs multi-org
 * lifecycle approval. The DECISION is still written to the ledger as an
 * AuditEvent carrying policyId, so the ledger remains the authoritative record
 * of what rule was in force when.
 *
 * ---------------------------------------------------------------------------
 * [OPEN-E] — UNRESOLVED, AND IT MOVES THE BUSINESS CASE. Raised by review,
 * 23 August 2026. Compliance and the product owner must settle it before
 * these numbers are shown to anyone as a forecast.
 *
 * EWA and ASA are set to A2 below — VERISYS + DOC_AUTH + BIOMETRIC_1TO1, no
 * liveness. Consolidated Product Manual v2 Part Two §9.3 says otherwise:
 *
 *   "Fingerprint and live-selfie face verification apply across EWA, ASA and
 *    SBL — documented once here rather than per product."
 *
 * Read as an identity requirement, that is A3 for all three products, and the
 * A2 defaults here are too low. Read that way, the wallet journey (which
 * produces A2) would never satisfy EWA on its own, every EWA request would
 * answer STEP_UP for one liveness check, and the headline "instant, zero rail
 * calls" for EWA in the blueprint's product table becomes "one selfie".
 *
 * There is a second reading, and the review could not settle which is right
 * from the manual alone. §9.3 sits in the Employee App chapter and describes
 * the per-REQUEST journey: "Review Details -> Biometric Verification -> ...
 * before the request proceeds to approval", capped at 3 attempts per day. That
 * is transaction authorisation — proving the person asking for this money is
 * the account holder — not customer due diligence. A per-transaction
 * authentication is not reusable by anything, and a KYC ledger cannot avoid
 * it. On this reading A2 is the correct CDD floor and the liveness step simply
 * sits outside this system's scope.
 *
 * The distinction matters more than the levels do, because THIS CODEBASE HAS
 * NO CONCEPT OF IT. `decide()` answers one question — is the identity on file
 * good enough — and the rail metrics count every method it avoids as a saving.
 * If §9.3's biometric is transaction authorisation, then some of what the
 * demo reports as avoided cost is spend that would occur anyway, and the
 * savings figure is overstated by whatever share of it is per-request
 * authentication rather than per-customer verification.
 *
 * Deliberately NOT silently changed to A3 here. Either reading changes the
 * numbers the programme is being sold on, and choosing between them is a
 * Compliance and product decision, not a refactor. What the review could do
 * without that decision is stop the ambiguity being invisible: see
 * docs/GAP_ANALYSIS.md [OPEN-E] and the caveat carried on the savings figures.
 * ---------------------------------------------------------------------------
 */

const BASE: Omit<
  ProductPolicy,
  'productId' | 'minAssurance' | 'maxAgeDays' | 'disclosableAttributes'
> = {
  docType: 'ProductPolicy',
  policyVersion: 1,
  requireConsent: true,
  denyOnCnicExpiry: true,
  effectiveFrom: '2026-09-01T00:00:00Z',
  effectiveTo: null,
  approvedBy: ['PENDING:Compliance', 'PENDING:ProductOwner'],
  createdTxId: 'genesis-policy',
};

export const PRODUCT_POLICIES: Readonly<Record<string, ProductPolicy>> = Object.freeze({
  // [OPEN-E] applies to EWA and ASA: Product Manual Part Two §9.3 puts a
  // live-selfie check on both, which is A3 if it is a CDD step. See the file
  // header — unresolved, and it moves the savings figure.
  EWA: {
    ...BASE,
    productId: 'EWA',
    minAssurance: 'A2',
    maxAgeDays: 365,
    disclosableAttributes: ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
  },
  ASA: {
    ...BASE,
    productId: 'ASA',
    minAssurance: 'A2',
    maxAgeDays: 365,
    disclosableAttributes: ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
  },
  SBL: {
    ...BASE,
    productId: 'SBL',
    minAssurance: 'A3',
    maxAgeDays: 180,
    disclosableAttributes: [
      'verisys_match',
      'biometric_match',
      'cnic_expiry',
      'fatca_status',
      'liveness_pass',
      'date_of_birth',
    ],
  },
  MERCHANT_FINANCING: {
    ...BASE,
    productId: 'MERCHANT_FINANCING',
    minAssurance: 'A3',
    maxAgeDays: 180,
    disclosableAttributes: ['verisys_match', 'biometric_match', 'liveness_pass', 'cnic_expiry'],
  },
  EMPLOYER_BULK: {
    ...BASE,
    productId: 'EMPLOYER_BULK',
    minAssurance: 'A2',
    maxAgeDays: 365,
    disclosableAttributes: ['verisys_match', 'biometric_match', 'cnic_expiry'],
  },
  // Read-only partner access. [OPEN-7] — partners may not WRITE in v1.
  PARTNER_READ: {
    ...BASE,
    productId: 'PARTNER_READ',
    minAssurance: 'A2',
    maxAgeDays: 365,
    disclosableAttributes: ['verisys_match', 'cnic_expiry'],
  },
  // The wallet originates verifications; it never relies on an existing one.
  WALLET: {
    ...BASE,
    productId: 'WALLET',
    minAssurance: 'A0',
    maxAgeDays: 365,
    disclosableAttributes: [],
  },
});

export function getPolicy(productId: string): ProductPolicy | null {
  return PRODUCT_POLICIES[productId] ?? null;
}

/**
 * The union of every attribute any product policy can disclose.
 *
 * This is the absolute ceiling on a consent grant: a consent broader than this
 * could never be honoured by any policy, so recording one is meaningless and
 * misleading in an audit. Enforced at grant time (finding SEC-10).
 */
export const MAX_DISCLOSABLE_ATTRIBUTES: readonly string[] = Object.freeze(
  [...new Set(Object.values(PRODUCT_POLICIES).flatMap((p) => p.disclosableAttributes))].sort(),
);

/** Ceiling for a specific product, where the caller knows which one applies. */
export function scopeCeilingFor(productId?: string): readonly string[] {
  if (productId === undefined) return MAX_DISCLOSABLE_ATTRIBUTES;
  return getPolicy(productId)?.disclosableAttributes ?? MAX_DISCLOSABLE_ATTRIBUTES;
}

export function policyId(p: ProductPolicy): string {
  return `${p.productId}@v${p.policyVersion}`;
}
