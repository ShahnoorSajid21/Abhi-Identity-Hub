import { COMPLIANCE_MSP, fail, type ProductPolicy } from '@abhi/types';

/**
 * Policy approval workflow (control C-11).
 *
 * A product policy change is a BULK KYC DECISION: lowering EWA's minimum
 * assurance from A2 to A1 silently re-classifies every future EWA customer.
 * It therefore carries the same governance as a KYC write — Compliance plus
 * the product owner, two distinct human identities, recorded on the ledger.
 *
 * The engine refuses to evaluate an unapproved policy. That refusal is the
 * whole control: without it, "approvedBy" is a comment.
 */

export interface ApprovalRecord {
  /** Identity of the approver, e.g. 'ABHIComplianceMSP:asma.k'. */
  approver: string;
  /** MSP the approver belongs to. */
  mspId: string;
  role: 'compliance' | 'product-owner' | 'risk';
  approvedAt: string;
  /** Free-text rationale, retained for audit. */
  rationale: string;
}

export interface PolicyChangeRequest {
  requestId: string;
  productId: string;
  /** The policy as proposed. */
  proposed: ProductPolicy;
  /** The policy currently in force, if any. */
  current: ProductPolicy | null;
  requestedBy: string;
  requestedAt: string;
  approvals: ApprovalRecord[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EFFECTIVE';
}

export const PENDING_APPROVER_PREFIX = 'PENDING:';

/** A policy is approved only when no approver slot is still a placeholder. */
export function isApproved(policy: ProductPolicy): boolean {
  return (
    policy.approvedBy.length >= 2 &&
    !policy.approvedBy.some((a) => a.startsWith(PENDING_APPROVER_PREFIX))
  );
}

/**
 * Refuse to evaluate an unapproved policy in production.
 *
 * Outside production this warns rather than throws, so the POC and its demos
 * keep working with the shipped engineering defaults — which are deliberately
 * marked PENDING: so they cannot be mistaken for Compliance-approved policy.
 */
export function assertPolicyUsable(policy: ProductPolicy): void {
  if (isApproved(policy)) return;

  if (process.env['NODE_ENV'] === 'production') {
    fail(
      'ERR_INVALID_SCOPE',
      `policy ${policy.productId}@v${policy.policyVersion} is not approved: ` +
        `${policy.approvedBy.filter((a) => a.startsWith(PENDING_APPROVER_PREFIX)).join(', ')}. ` +
        'Compliance and the product owner must both approve before production use.',
    );
  }
}

/**
 * Validate a set of approvals against the four-eyes rule.
 *
 * Three conditions, each of which has been a real control failure somewhere:
 *   1. At least two approvals — one person cannot change policy alone.
 *   2. Two DISTINCT identities — the same person approving twice is one person.
 *   3. At least one from Compliance — a product owner and their manager are
 *      not independent oversight of a compliance control.
 */
export function validateApprovals(approvals: readonly ApprovalRecord[]): void {
  if (approvals.length < 2) {
    fail('ERR_INVALID_SCOPE', 'a policy change requires at least two approvals');
  }

  const identities = new Set(approvals.map((a) => a.approver));
  if (identities.size < 2) {
    fail('ERR_INVALID_SCOPE', 'approvals must come from two distinct identities');
  }

  if (!approvals.some((a) => a.mspId === COMPLIANCE_MSP && a.role === 'compliance')) {
    fail('ERR_INVALID_SCOPE', 'a policy change requires Compliance approval');
  }

  for (const a of approvals) {
    if (a.rationale.trim().length === 0) {
      fail('ERR_REASON_REQUIRED', `approver ${a.approver} gave no rationale`);
    }
  }
}

/**
 * Classify the risk of a proposed change.
 *
 * A LOOSENING is materially different from a tightening and should route to a
 * higher approval bar: lowering minAssurance or extending maxAgeDays increases
 * the population the bank will rely on without fresh verification.
 */
export function classifyChange(
  current: ProductPolicy | null,
  proposed: ProductPolicy,
): { direction: 'NEW' | 'LOOSENING' | 'TIGHTENING' | 'NEUTRAL'; reasons: string[] } {
  if (current === null) return { direction: 'NEW', reasons: ['no policy previously in force'] };

  const rank = { A0: 0, A1: 1, A2: 2, A3: 3 } as const;
  const reasons: string[] = [];
  let loosened = false;
  let tightened = false;

  if (rank[proposed.minAssurance] < rank[current.minAssurance]) {
    loosened = true;
    reasons.push(`minAssurance lowered ${current.minAssurance} -> ${proposed.minAssurance}`);
  } else if (rank[proposed.minAssurance] > rank[current.minAssurance]) {
    tightened = true;
    reasons.push(`minAssurance raised ${current.minAssurance} -> ${proposed.minAssurance}`);
  }

  if (proposed.maxAgeDays > current.maxAgeDays) {
    loosened = true;
    reasons.push(`maxAgeDays extended ${current.maxAgeDays} -> ${proposed.maxAgeDays}`);
  } else if (proposed.maxAgeDays < current.maxAgeDays) {
    tightened = true;
    reasons.push(`maxAgeDays shortened ${current.maxAgeDays} -> ${proposed.maxAgeDays}`);
  }

  const added = proposed.disclosableAttributes.filter(
    (a) => !current.disclosableAttributes.includes(a),
  );
  if (added.length > 0) {
    loosened = true;
    reasons.push(`disclosure widened: +${added.join(', ')}`);
  }

  if (current.denyOnCnicExpiry && !proposed.denyOnCnicExpiry) {
    loosened = true;
    reasons.push('CNIC expiry no longer blocks reliance');
  }

  if (loosened) return { direction: 'LOOSENING', reasons };
  if (tightened) return { direction: 'TIGHTENING', reasons };
  return { direction: 'NEUTRAL', reasons: reasons.length > 0 ? reasons : ['no material change'] };
}

/** Approve a change request, producing the policy that may be put in force. */
export function approve(
  request: PolicyChangeRequest,
  approvals: readonly ApprovalRecord[],
  effectiveFrom: string,
): ProductPolicy {
  validateApprovals(approvals);

  const change = classifyChange(request.current, request.proposed);

  // A loosening needs Risk as well as Compliance. Widening who the bank will
  // rely on without fresh verification is a risk decision, not a product one.
  if (change.direction === 'LOOSENING') {
    if (!approvals.some((a) => a.role === 'risk')) {
      fail(
        'ERR_INVALID_SCOPE',
        `loosening change requires Risk approval: ${change.reasons.join('; ')}`,
      );
    }
  }

  return {
    ...request.proposed,
    policyVersion: (request.current?.policyVersion ?? 0) + 1,
    approvedBy: approvals.map((a) => a.approver),
    effectiveFrom,
    effectiveTo: null,
  };
}
