import { assertNoPII, assertMaxBytes, fail, MSP_IDS, COMPLIANCE_MSP } from '@abhi/types';
import type { TxContext } from './state.ts';

export const MAX_PAYLOAD_BYTES = 4096;

export interface GuardSpec {
  /** Restrict to ABHIComplianceMSP. */
  complianceOnly?: boolean;
  /** Require this exact `kyc.role` certificate attribute. */
  role?: string;
  /** Payload scanned for PII and size. */
  payload?: unknown;
}

/**
 * Common security checks, applied by every mutating function in this order.
 *
 * On check 3 specifically: Fabric's endorsement policy governs whether a
 * transaction COMMITS, not who may PROPOSE it. A product organization can
 * propose SuspendKYC; without this in-chaincode MSP check it would fail only
 * at endorsement, producing a confusing error and no clean audit record. The
 * explicit check makes the rejection deliberate, attributable and logged.
 */
export function guard(ctx: TxContext, spec: GuardSpec = {}): void {
  // 1. Caller MSP is a known network member.
  if (!(MSP_IDS as readonly string[]).includes(ctx.mspId)) {
    fail('ERR_UNKNOWN_MSP', `caller MSP ${ctx.mspId} is not a network member`);
  }

  // 2. Role attribute, where the function demands one.
  if (spec.role !== undefined && ctx.role !== spec.role) {
    fail('ERR_INSUFFICIENT_ROLE', `requires kyc.role=${spec.role}, caller has ${ctx.role ?? 'none'}`);
  }

  // 3. Compliance-exclusive operations.
  if (spec.complianceOnly === true && ctx.mspId !== COMPLIANCE_MSP) {
    fail('ERR_COMPLIANCE_ONLY', `${ctx.mspId} may not invoke a Compliance-only function`);
  }

  // 4. PII tripwire over the entire serialised payload.
  if (spec.payload !== undefined) {
    assertNoPII(spec.payload);
    // 5. Payload size ceiling.
    assertMaxBytes(spec.payload, MAX_PAYLOAD_BYTES);
  }
}

export function requireNonEmpty(value: unknown, code: Parameters<typeof fail>[0], field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, `${field} is required`);
  }
  if (value.length > 512) fail(code, `${field} exceeds 512 characters`);
  return value;
}
