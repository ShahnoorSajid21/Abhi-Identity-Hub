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
