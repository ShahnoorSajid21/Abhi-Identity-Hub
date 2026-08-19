/**
 * kyc-registry — Hyperledger Fabric contract binding.
 *
 * REQUIRES: npm i fabric-contract-api fabric-shim
 *
 * A thin translation layer only: unmarshal arguments, delegate to the pure
 * domain in registry.ts, marshal the result. No business logic lives here, by
 * design — everything below is exercised by the 47 domain tests without a
 * network, and this file adds only the Fabric plumbing those tests cannot cover.
 *
 * Endorsement policy (set at approve/commit time, see network/scripts):
 *   AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer','ABHILendingMSP.peer'))
 */
import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { ATTRIBUTE_NAMES } from '@abhi/merkle';
import type { AssuranceLevel, ProductPolicy, VerificationMethod } from '@abhi/types';
import type { ProofBundle } from '@abhi/merkle';
import { FabricStateStore, fabricContext } from './fabric-adapter.ts';
import {
  registerKYC,
  verifyKYC,
  updateKYC,
  suspendKYC,
  reinstateKYC,
  recordConsent,
  revokeConsent,
  markShredded,
  getVersionChain,
  generateProof,
  verifyProof,
  getAuditTrail,
} from './registry.ts';

const KNOWN_ATTRIBUTES: readonly string[] = [...ATTRIBUTE_NAMES];

/** Parse a JSON argument, failing loudly rather than yielding undefined. */
function json<T>(raw: string, field: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`ERR_INVALID_SCOPE: ${field} must be valid JSON`);
  }
}

@Info({
  title: 'kyc-registry',
  description:
    'ABHI Unified KYC Ledger. Stores cryptographic commitments and metadata — never personal data.',
})
export class KycRegistryContract extends Contract {
  constructor() {
    super('KycRegistryContract');
  }

  // -------------------------------------------------------------- writes

  @Transaction()
  @Returns('string')
  async RegisterKYC(
    ctx: Context,
    subjectId: string,
    merkleRoot: string,
    attributeSetId: string,
    assuranceLevel: string,
    methodsJson: string,
    expiresAt: string,
    cnicExpiryAt: string,
    vaultRef: string,
    pepperEpoch: string,
    originProduct: string,
  ): Promise<string> {
    const result = await registerKYC(new FabricStateStore(ctx), fabricContext(ctx), {
      subjectId,
      merkleRoot,
      attributeSetId,
      assuranceLevel: assuranceLevel as AssuranceLevel,
      methods: json<VerificationMethod[]>(methodsJson, 'methods'),
      expiresAt,
      cnicExpiryAt,
      vaultRef,
      pepperEpoch: Number(pepperEpoch),
      originProduct,
    });
    return JSON.stringify(result);
  }

  @Transaction()
  @Returns('string')
  async UpdateKYC(
    ctx: Context,
    subjectId: string,
    expectedCurrentVersion: string,
    merkleRoot: string,
    attributeSetId: string,
    assuranceLevel: string,
    methodsJson: string,
    expiresAt: string,
    cnicExpiryAt: string,
    vaultRef: string,
    updateReason: string,
  ): Promise<string> {
    const result = await updateKYC(new FabricStateStore(ctx), fabricContext(ctx), {
      subjectId,
      expectedCurrentVersion: Number(expectedCurrentVersion),
      merkleRoot,
      attributeSetId,
      assuranceLevel: assuranceLevel as AssuranceLevel,
      methods: json<VerificationMethod[]>(methodsJson, 'methods'),
      expiresAt,
      cnicExpiryAt,
      vaultRef,
      updateReason,
    });
    return JSON.stringify(result);
  }

  /** Compliance MSP only, kyc.role=compliance-officer. Enforced in the domain. */
  @Transaction()
  @Returns('string')
  async SuspendKYC(ctx: Context, subjectId: string, reason: string, referenceId: string): Promise<string> {
    const r = await suspendKYC(new FabricStateStore(ctx), fabricContext(ctx), subjectId, reason, referenceId);
    return JSON.stringify(r);
  }

  @Transaction()
  @Returns('string')
  async ReinstateKYC(ctx: Context, subjectId: string, reason: string, referenceId: string): Promise<string> {
    const r = await reinstateKYC(new FabricStateStore(ctx), fabricContext(ctx), subjectId, reason, referenceId);
    return JSON.stringify(r);
  }

  @Transaction()
  @Returns('string')
  async RecordConsent(
    ctx: Context,
    consentId: string,
    subjectId: string,
    grantedTo: string,
    purpose: string,
    scopeJson: string,
    expiresAt: string,
    evidenceRef: string,
    maxScopeJson: string,
  ): Promise<string> {
    const r = await recordConsent(
      new FabricStateStore(ctx),
      fabricContext(ctx),
      {
        consentId,
        subjectId,
        grantedTo,
        purpose,
        scope: json<string[]>(scopeJson, 'scope'),
        expiresAt,
        evidenceRef,
      },
      KNOWN_ATTRIBUTES,
      maxScopeJson === '' ? undefined : json<string[]>(maxScopeJson, 'maxScope'),
    );
    return JSON.stringify(r);
  }

  @Transaction()
  @Returns('string')
  async RevokeConsent(
    ctx: Context,
    subjectId: string,
    grantedTo: string,
    consentId: string,
    reason: string,
  ): Promise<string> {
    const r = await revokeConsent(
      new FabricStateStore(ctx),
      fabricContext(ctx),
      subjectId,
      grantedTo,
      consentId,
      reason,
    );
    return JSON.stringify(r);
  }

  /**
   * Compliance only. The vault must already be destroyed when this is called —
   * reversing that order would leave the ledger asserting an erasure that did
   * not happen.
   */
  @Transaction()
  @Returns('string')
  async MarkShredded(
    ctx: Context,
    subjectId: string,
    reason: string,
    legalBasis: string,
    shredCertificateRef: string,
  ): Promise<string> {
    const r = await markShredded(
      new FabricStateStore(ctx),
      fabricContext(ctx),
      subjectId,
      reason,
      legalBasis,
      shredCertificateRef,
    );
    return JSON.stringify(r);
  }

  @Transaction()
  @Returns('string')
  async GenerateProof(
    ctx: Context,
    subjectId: string,
    productId: string,
    requestedAttributesJson: string,
    consentId: string,
    policyJson: string,
  ): Promise<string> {
    const r = await generateProof(
      new FabricStateStore(ctx),
      fabricContext(ctx),
      subjectId,
      productId,
      json<string[]>(requestedAttributesJson, 'requestedAttributes'),
      consentId,
      json<ProductPolicy>(policyJson, 'policy'),
    );
    return JSON.stringify(r);
  }

  // -------------------------------------------------------------- queries

  @Transaction(false)
  @Returns('string')
  async VerifyKYC(ctx: Context, subjectId: string): Promise<string> {
    const r = await verifyKYC(new FabricStateStore(ctx), fabricContext(ctx), subjectId);
    return JSON.stringify(r);
  }

  @Transaction(false)
  @Returns('string')
  async GetVersionChain(ctx: Context, subjectId: string, verifyIntegrity: string): Promise<string> {
    const r = await getVersionChain(
      new FabricStateStore(ctx),
      fabricContext(ctx),
      subjectId,
      verifyIntegrity !== 'false',
    );
    return JSON.stringify(r);
  }

  @Transaction(false)
  @Returns('string')
  async VerifyProof(ctx: Context, subjectId: string, bundleJson: string): Promise<string> {
    const r = await verifyProof(
      new FabricStateStore(ctx),
      fabricContext(ctx),
      subjectId,
      json<ProofBundle>(bundleJson, 'bundle'),
    );
    return JSON.stringify(r);
  }

  @Transaction(false)
  @Returns('string')
  async GetAuditTrail(ctx: Context, subjectId: string): Promise<string> {
    const r = await getAuditTrail(new FabricStateStore(ctx), fabricContext(ctx), subjectId);
    return JSON.stringify(r);
  }
}

export const contracts: unknown[] = [KycRegistryContract];
