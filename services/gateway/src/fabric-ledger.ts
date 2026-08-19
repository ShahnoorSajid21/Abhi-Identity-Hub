/**
 * FabricLedger — LedgerPort over the Fabric Gateway SDK.
 *
 * REQUIRES: npm i @hyperledger/fabric-gateway @grpc/grpc-js
 *
 * Closes GAP-02. The SimulatedLedger runs the identical domain logic; what
 * this adds — and it is the whole point — is endorsement, ordering and
 * independent peers. None of the governance properties exist without it.
 */
import { connect, signers, type Contract, type Gateway, type Identity, type Signer } from '@hyperledger/fabric-gateway';
import * as grpc from '@grpc/grpc-js';
import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { KycError, type ErrorCode, type ProductPolicy } from '@abhi/types';
import type { ProofBundle } from '@abhi/merkle';
import type { TxContext, RegisterKYCInput, UpdateKYCInput, RecordConsentInput } from '@abhi/kyc-registry';
import type { LedgerPort } from './ledger.ts';

export interface FabricConfig {
  channelName: string;
  chaincodeName: string;
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsRootCertPath: string;
  certPath: string;
  keyPath: string;
  /**
   * Peers whose endorsement must be collected.
   *
   * MUST include a Compliance peer for every write, or the transaction will be
   * rejected at validation with ENDORSEMENT_POLICY_FAILURE. Listing only the
   * caller's own peer is the single most common integration mistake here.
   */
  endorsingOrgs: string[];
}

const utf8 = new TextDecoder();

/**
 * Map a chaincode error string back to a typed KycError.
 *
 * Fabric flattens errors to strings across the gRPC boundary, so the error
 * code has to be recovered by inspection. Without this the gateway would
 * return 500 for what are really 403s and 409s, and the API contract in
 * openapi.yaml would be a fiction.
 */
function translate(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  const match = /\b(ERR_[A-Z_]+)\b/.exec(message);
  if (match !== null) {
    const detail = message.split(match[1]!)[1]?.replace(/^:\s*/, '').trim();
    throw new KycError(match[1] as ErrorCode, detail === '' ? undefined : detail);
  }

  if (/ENDORSEMENT_POLICY_FAILURE/i.test(message)) {
    throw new KycError(
      'ERR_COMPLIANCE_ONLY',
      'endorsement policy not satisfied — Compliance co-endorsement is required for every write',
    );
  }
  if (/MVCC_READ_CONFLICT|PHANTOM_READ_CONFLICT/i.test(message)) {
    throw new KycError('ERR_VERSION_CONFLICT', 'concurrent update; retry with the current version');
  }
  throw error instanceof Error ? error : new Error(message);
}

export class FabricLedger implements LedgerPort {
  readonly mode = 'fabric' as const;
  readonly #contract: Contract;
  readonly #gateway: Gateway;
  readonly #client: grpc.Client;
  readonly #endorsingOrgs: string[];

  private constructor(gateway: Gateway, client: grpc.Client, cfg: FabricConfig) {
    this.#gateway = gateway;
    this.#client = client;
    this.#endorsingOrgs = cfg.endorsingOrgs;
    this.#contract = gateway.getNetwork(cfg.channelName).getContract(cfg.chaincodeName);
  }

  static async connect(cfg: FabricConfig): Promise<FabricLedger> {
    const tlsRootCert = readFileSync(cfg.tlsRootCertPath);
    const credentials = grpc.credentials.createSsl(tlsRootCert);
    const client = new grpc.Client(cfg.peerEndpoint, credentials, {
      'grpc.ssl_target_name_override': cfg.peerHostAlias,
      'grpc.max_receive_message_length': 16 * 1024 * 1024,
    });

    const identity: Identity = { mspId: cfg.mspId, credentials: readFileSync(cfg.certPath) };
    const signer: Signer = signers.newPrivateKeySigner(
      createPrivateKey(readFileSync(cfg.keyPath)),
    );

    const gateway = connect({
      client,
      identity,
      signer,
      // Budgets tuned so a slow endorsement surfaces as a timeout rather than
      // an indefinite hang on the customer's critical path.
      evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 5_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
    });

    return new FabricLedger(gateway, client, cfg);
  }

  close(): void {
    this.#gateway.close();
    this.#client.close();
  }

  /** Submit: ordered, endorsed, committed. Every write goes through here. */
  async #submit<T>(name: string, ...args: string[]): Promise<T> {
    try {
      const bytes = await this.#contract.submit(name, {
        arguments: args,
        endorsingOrganizations: this.#endorsingOrgs,
      });
      return JSON.parse(utf8.decode(bytes)) as T;
    } catch (e) {
      translate(e);
    }
  }

  /** Evaluate: single-peer read, no ordering, no commit. */
  async #evaluate<T>(name: string, ...args: string[]): Promise<T> {
    try {
      const bytes = await this.#contract.evaluate(name, { arguments: args });
      return JSON.parse(utf8.decode(bytes)) as T;
    } catch (e) {
      translate(e);
    }
  }

  // NOTE — ctx is unused on this path. Under Fabric, identity comes from the
  // signing certificate and time from the transaction, both established by the
  // network. Accepting a caller-supplied context and ignoring it is deliberate:
  // it keeps LedgerPort uniform, and it means a compromised gateway cannot
  // influence verifiedBy or verifiedAt even by lying in the port call.
  async register(_ctx: TxContext, i: RegisterKYCInput) {
    return this.#submit<{ version: number; recordHash: string }>(
      'RegisterKYC',
      i.subjectId, i.merkleRoot, i.attributeSetId, i.assuranceLevel,
      JSON.stringify(i.methods), i.expiresAt, i.cnicExpiryAt, i.vaultRef,
      String(i.pepperEpoch), i.originProduct,
    );
  }

  async verify(_ctx: TxContext, subjectId: string) {
    return this.#evaluate<Awaited<ReturnType<LedgerPort['verify']>>>('VerifyKYC', subjectId);
  }

  async update(_ctx: TxContext, i: UpdateKYCInput) {
    return this.#submit<Awaited<ReturnType<LedgerPort['update']>>>(
      'UpdateKYC',
      i.subjectId, String(i.expectedCurrentVersion), i.merkleRoot, i.attributeSetId,
      i.assuranceLevel, JSON.stringify(i.methods), i.expiresAt, i.cnicExpiryAt,
      i.vaultRef, i.updateReason,
    );
  }

  async suspend(_ctx: TxContext, subjectId: string, reason: string, ref: string) {
    return this.#submit<Awaited<ReturnType<LedgerPort['suspend']>>>('SuspendKYC', subjectId, reason, ref);
  }

  async reinstate(_ctx: TxContext, subjectId: string, reason: string, ref: string) {
    return this.#submit<Awaited<ReturnType<LedgerPort['reinstate']>>>('ReinstateKYC', subjectId, reason, ref);
  }

  async consent(_ctx: TxContext, i: RecordConsentInput, _known: readonly string[], maxScope?: readonly string[]) {
    return this.#submit<Awaited<ReturnType<LedgerPort['consent']>>>(
      'RecordConsent',
      i.consentId, i.subjectId, i.grantedTo, i.purpose, JSON.stringify(i.scope),
      i.expiresAt, i.evidenceRef,
      maxScope === undefined ? '' : JSON.stringify(maxScope),
    );
  }

  async revoke(_ctx: TxContext, subjectId: string, grantedTo: string, consentId: string, reason: string) {
    return this.#submit<Awaited<ReturnType<LedgerPort['revoke']>>>(
      'RevokeConsent', subjectId, grantedTo, consentId, reason,
    );
  }

  async shred(_ctx: TxContext, subjectId: string, reason: string, basis: string, cert: string) {
    return this.#submit<Awaited<ReturnType<LedgerPort['shred']>>>(
      'MarkShredded', subjectId, reason, basis, cert,
    );
  }

  async chain(_ctx: TxContext, subjectId: string) {
    return this.#evaluate<Awaited<ReturnType<LedgerPort['chain']>>>('GetVersionChain', subjectId, 'true');
  }

  async authoriseProof(
    _ctx: TxContext,
    subjectId: string,
    productId: string,
    requested: readonly string[],
    consentId: string,
    policy: ProductPolicy,
  ) {
    return this.#submit<Awaited<ReturnType<LedgerPort['authoriseProof']>>>(
      'GenerateProof', subjectId, productId, JSON.stringify(requested), consentId, JSON.stringify(policy),
    );
  }

  async checkProof(_ctx: TxContext, subjectId: string, bundle: ProofBundle) {
    return this.#evaluate<Awaited<ReturnType<LedgerPort['checkProof']>>>(
      'VerifyProof', subjectId, JSON.stringify(bundle),
    );
  }

  async audit(_ctx: TxContext, subjectId: string) {
    return this.#evaluate<Awaited<ReturnType<LedgerPort['audit']>>>('GetAuditTrail', subjectId);
  }
}
