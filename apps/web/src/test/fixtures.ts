import { vi } from 'vitest';
import type { VerifyDecision, VerifyResult } from '../lib/verify.ts';
import type { VerificationMethod } from '../lib/api.ts';

/**
 * The four VerifyKYC responses, shaped exactly as the gateway returns them.
 *
 * These mirror `VerifyResult` in services/gateway/src/service.ts. The E2E
 * suite in tests/e2e asserts the real gateway produces these same shapes, so
 * a drift between the two is caught on the backend side rather than being
 * silently absorbed by a hand-written mock here.
 */

export const SUBJECT_A2 = 'a'.repeat(64);

function decision(over: Partial<VerifyDecision>): VerifyDecision {
  return {
    outcome: 'ALLOW',
    reason: 'SUFFICIENT',
    missingMethods: [],
    disclosableAttributes: [],
    ageDays: 12,
    currentAssurance: 'A2',
    requiredAssurance: 'A2',
    policyId: 'EWA@v1',
    ...over,
  };
}

function result(over: Partial<VerifyResult>, dec: Partial<VerifyDecision>): VerifyResult {
  return {
    subjectId: SUBJECT_A2,
    decision: decision(dec),
    proof: null,
    railCallsAvoided: 0,
    costAvoidedPkr: 0,
    // A clean credit check by default. Fixtures that need an adverse record
    // override `eCib` — the two must be able to differ, because the whole
    // point of carrying the outcome is that "ran" and "passed" are not
    // the same fact.
    eCibCalled: true,
    eCib: { called: true, clean: true, ref: 'ECIB:fixture' },
    ...over,
  };
}

export const ALLOW: VerifyResult = result(
  {
    railCallsAvoided: 3,
    costAvoidedPkr: 245,
    proof: {
      merkleRoot: 'f'.repeat(64),
      attributeSetId: 'ABHI-KYC-ATTRS-v1',
      attributes: [
        { name: 'verisys_match', canonical: 'b:true', salt: '1'.repeat(64), path: [] },
        { name: 'biometric_match', canonical: 'b:true', salt: '2'.repeat(64), path: [] },
      ],
    },
  },
  {
    outcome: 'ALLOW',
    reason: 'SUFFICIENT',
    disclosableAttributes: ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
  },
);

/** The headline case: an A2 customer applying for SBL needs one selfie. */
export const STEP_UP_LIVENESS: VerifyResult = result(
  {},
  {
    outcome: 'STEP_UP',
    reason: 'ASSURANCE_LOW',
    missingMethods: ['LIVENESS'],
    currentAssurance: 'A2',
    requiredAssurance: 'A3',
    policyId: 'SBL@v1',
  },
);

/** An A1 customer applying for EWA needs a fingerprint, not a selfie. */
export const STEP_UP_BIOMETRIC: VerifyResult = result(
  {},
  {
    outcome: 'STEP_UP',
    reason: 'ASSURANCE_LOW',
    missingMethods: ['BIOMETRIC_1TO1'],
    currentAssurance: 'A1',
    requiredAssurance: 'A2',
    policyId: 'EWA@v1',
  },
);

export const FULL_KYC: VerifyResult = result(
  { subjectId: 'b'.repeat(64), eCibCalled: true },
  {
    outcome: 'FULL_KYC',
    reason: 'NO_RECORD',
    missingMethods: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'],
    ageDays: null,
    currentAssurance: null,
    requiredAssurance: 'A2',
  },
);

export const DENY_CNIC_EXPIRED: VerifyResult = result(
  { eCibCalled: false },
  {
    outcome: 'DENY',
    reason: 'CNIC_EXPIRED',
    currentAssurance: 'A3',
    requiredAssurance: 'A3',
    policyId: 'SBL@v1',
  },
);

export const DENY_SUSPENDED: VerifyResult = result(
  { eCibCalled: false },
  {
    outcome: 'DENY',
    reason: 'SUSPENDED',
    currentAssurance: 'A3',
    requiredAssurance: 'A2',
    policyId: 'EWA@v1',
  },
);

export function stepUpWith(
  missingMethods: VerificationMethod[],
  requiredAssurance = 'A2',
): VerifyResult {
  return result({}, { outcome: 'STEP_UP', reason: 'ASSURANCE_LOW', missingMethods, requiredAssurance });
}

/** Stub global fetch with one VerifyKYC response. Returns the spy. */
export function stubVerify(response: VerifyResult) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'test-corr-1' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}
