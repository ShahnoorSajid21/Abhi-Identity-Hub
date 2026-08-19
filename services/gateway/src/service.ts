import { randomUUID } from 'node:crypto';
import {
  ATTRIBUTE_NAMES,
  ATTRIBUTE_SET_ID,
  buildAttributeSet,
  generateProofBundle,
  newSalt,
  normaliseCnic,
  verifyProofBundle,
  type Attribute,
  type ProofBundle,
} from '@abhi/merkle';
import { merkleRootHex } from '@abhi/merkle';
import {
  decide,
  getPolicy,
  assertPolicyUsable,
  MAX_DISCLOSABLE_ATTRIBUTES,
  type Decision,
} from '@abhi/policy';
import {
  assertHex64,
  fail,
  REQUIRED_METHODS,
  type AssuranceLevel,
  type AuditEvent,
  type ConsentRecord,
  type KYCRecord,
  type VerificationMethod,
} from '@abhi/types';
import type { TxContext } from '@abhi/kyc-registry';
import type { LedgerPort, SubjectSummary } from './ledger.ts';
import type { Vault, VaultPayload } from './vault.ts';
import type { Hsm } from './hsm.ts';
import { MockECib, MockRails } from './rails.ts';
import type { EmploymentRegister } from './security.ts';

const KNOWN_ATTRIBUTES: readonly string[] = [...ATTRIBUTE_NAMES];

/** Assurance level implied by the set of methods that actually succeeded. */
export function levelFromMethods(methods: readonly VerificationMethod[]): AssuranceLevel {
  const have = new Set(methods);
  const has = (l: AssuranceLevel): boolean => REQUIRED_METHODS[l].every((m) => have.has(m));
  if (has('A3')) return 'A3';
  if (has('A2')) return 'A2';
  if (has('A1')) return 'A1';
  return 'A0';
}

export interface VerificationInput {
  cnic: string;
  attributes: Record<string, string | boolean | number>;
  originProduct: string;
  cnicExpiryAt: string;
  /** Explicit override; otherwise derived from which outcome attributes are true. */
  methodsToRun?: readonly VerificationMethod[];
}

export interface RegisterResult {
  subjectId: string;
  version: number;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  merkleRoot: string;
  railCallsMade: number;
  costSpentPkr: number;
}

export interface VerifyResult {
  subjectId: string;
  decision: Decision;
  proof: ProofBundle | null;
  railCallsAvoided: number;
  costAvoidedPkr: number;
  eCibCalled: boolean;
}

export interface GatewayDeps {
  ledger: LedgerPort;
  vault: Vault;
  hsm: Hsm;
  rails: MockRails;
  ecib: MockECib;
  /**
   * Employment roster gating employer bulk lookups (SEC-05).
   *
   * Optional so existing callers and the simulator keep working, but when it
   * is absent the lookup is an unrestricted existence oracle over ABHI's
   * customer base — so production MUST supply it, and the gateway logs a
   * warning at construction when it does not.
   */
  employment?: EmploymentRegister;
}

/** Days an assurance level remains valid before re-affirmation. */
const ASSURANCE_VALIDITY_DAYS: Record<AssuranceLevel, number> = {
  A0: 180,
  A1: 365,
  A2: 365,
  A3: 180,
};

export class KycGatewayService {
  readonly #d: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.#d = deps;
  }

  /** subject_id = HMAC-SHA256(pepper, normalise(CNIC)) — never leaves the HSM. */
  async subjectId(cnic: string): Promise<string> {
    return this.#d.hsm.hmacPepper(Buffer.from(normaliseCnic(cnic), 'utf8'));
  }

  #expiryFor(level: AssuranceLevel, now: Date): string {
    const d = new Date(now.getTime() + ASSURANCE_VALIDITY_DAYS[level] * 86_400_000);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /** Build the salted attribute set and commit its root. Salts go to the vault. */
  #buildAttributes(values: Record<string, string | boolean | number>): {
    attrs: Attribute[];
    payload: VaultPayload;
  } {
    const attrs = buildAttributeSet(values, () => newSalt());
    const salts: Record<string, string> = {};
    for (const a of attrs) salts[a.name] = a.salt.toString('hex');
    return { attrs, payload: { attributes: values, salts } };
  }

  // -------------------------------------------------------------------
  // Operation 1 — Register
  // -------------------------------------------------------------------
  async register(ctx: TxContext, input: VerificationInput): Promise<RegisterResult> {
    const subjectId = await this.subjectId(input.cnic);

    // Run the full journey against the rails.
    //
    // A method is attempted only where its outcome attribute is explicitly
    // true. Reading a `false` attribute as "attempt it" would let a failed
    // liveness check inflate the record to A3 — the exact assurance-inflation
    // the chaincode consistency rule exists to stop, caught here first.
    const methods: VerificationMethod[] = [];
    const toAttempt =
      input.methodsToRun ??
      (['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1', 'LIVENESS'] as const).filter(
        (m) => input.attributes[methodToAttribute(m)] === true,
      );

    for (const method of toAttempt) {
      const r = await this.#d.rails.call(subjectId, method, ctx.timestamp);
      if (r.outcome) methods.push(method);
    }
    if (methods.length === 0) methods.push('ASSERTED');

    const level = levelFromMethods(methods);
    const { attrs, payload } = this.#buildAttributes(input.attributes);
    const merkleRoot = merkleRootHex(attrs);
    const vaultRef = await this.#d.vault.write(subjectId, 1, payload);

    const r = await this.#d.ledger.register(ctx, {
      subjectId,
      merkleRoot,
      attributeSetId: ATTRIBUTE_SET_ID,
      assuranceLevel: level,
      methods: [...methods].sort(),
      expiresAt: this.#expiryFor(level, ctx.timestamp),
      cnicExpiryAt: input.cnicExpiryAt,
      vaultRef,
      pepperEpoch: this.#d.hsm.pepperEpoch,
      originProduct: input.originProduct,
    });

    this.rememberVaultRef(subjectId, r.version, vaultRef);

    return {
      subjectId,
      version: r.version,
      assuranceLevel: level,
      methods: [...methods].sort(),
      merkleRoot,
      railCallsMade: this.#d.rails.metrics.callsMade,
      costSpentPkr: this.#d.rails.metrics.costSpentPkr,
    };
  }

  // -------------------------------------------------------------------
  // Operation 2 — Verify (the reuse path)
  // -------------------------------------------------------------------
  async verify(
    ctx: TxContext,
    cnic: string,
    productId: string,
    consentId: string | null,
    requestedAttributes?: readonly string[],
  ): Promise<VerifyResult> {
    return this.verifyBySubject(
      ctx,
      await this.subjectId(cnic),
      productId,
      consentId,
      requestedAttributes,
    );
  }

  /**
   * VerifyKYC keyed by subject id.
   *
   * The caller already holds the identifier and no CNIC is involved at any
   * point. This is the form the operations console and the customer journey
   * use: the console addresses customers by subject id precisely because a
   * subject id cannot be reversed to a citizen without the HSM pepper, and a
   * CNIC travelling to satisfy an internal lookup would put one in a URL, a
   * browser history and every access log on the path.
   *
   * Identical decision logic to verify() — the CNIC form simply derives the
   * subject id first. Sharing one body is deliberate: two copies of this state
   * machine would be two things to keep in step with Compliance.
   */
  async verifyBySubject(
    ctx: TxContext,
    subjectId: string,
    productId: string,
    consentId: string | null,
    requestedAttributes?: readonly string[],
  ): Promise<VerifyResult> {
    assertHex64(subjectId, 'ERR_INVALID_SUBJECT', 'subjectId');
    const policy = getPolicy(productId);
    if (policy === null) fail('ERR_INVALID_SCOPE', `unknown product ${productId}`);

    // C-11 — refuse to evaluate an unapproved policy in production. Without
    // this, `approvedBy` is a comment rather than a control.
    assertPolicyUsable(policy);

    const snapshot = await this.#d.ledger.verify(ctx, subjectId);

    const record: KYCRecord | null = snapshot.found
      ? ({
          assuranceLevel: snapshot.assuranceLevel!,
          methods: snapshot.methods,
          status: snapshot.status!,
          verifiedAt: snapshot.verifiedAt!,
          cnicExpiryAt: snapshot.cnicExpiryAt!,
          merkleRoot: snapshot.merkleRoot!,
          version: snapshot.version!,
        } as KYCRecord)
      : null;

    const decision = decide(record, policy, ctx.timestamp);

    // e-CIB ALWAYS runs at origination. It is a credit check, not an identity
    // check, and is never displaced by KYC reuse.
    let eCibCalled = false;
    if (decision.outcome !== 'DENY') {
      await this.#d.ecib.check(subjectId);
      eCibCalled = true;
    }

    let proof: ProofBundle | null = null;
    const before = this.#d.rails.metrics;

    if (decision.outcome === 'ALLOW') {
      // Every rail call the full journey WOULD have made is now avoided.
      this.#d.rails.recordAvoided(REQUIRED_METHODS[policy.minAssurance]);

      if (consentId !== null && snapshot.version !== null) {
        const requested = requestedAttributes ?? policy.disclosableAttributes;
        const auth = await this.#d.ledger.authoriseProof(
          ctx,
          subjectId,
          productId,
          requested,
          consentId,
          policy,
        );
        if (auth.authorised) {
          proof = await this.#assembleProof(subjectId, snapshot.version, auth.grantedAttributes, auth.merkleRoot!);
        }
      }
    }

    const after = this.#d.rails.metrics;
    return {
      subjectId,
      decision,
      proof,
      railCallsAvoided: after.callsAvoided - before.callsAvoided,
      costAvoidedPkr: after.costAvoidedPkr - before.costAvoidedPkr,
      eCibCalled,
    };
  }

  /**
   * Assemble a selective-disclosure bundle from vault salts.
   *
   * Self-verification is MANDATORY and happens twice: once inside
   * generateProofBundle, and once here against the root the ledger actually
   * holds. A proof that fails either check is a defect or an attack; either
   * way the request fails closed rather than returning something a product
   * might trust.
   */
  async #assembleProof(
    subjectId: string,
    version: number,
    disclose: readonly string[],
    ledgerRoot: string,
  ): Promise<ProofBundle> {
    const vaultRef = await this.#vaultRefFor(subjectId, version);
    if (vaultRef === null) fail('ERR_PROOF_ASSEMBLY_FAILED', 'no vault reference for this version');

    const payload = await this.#d.vault.read(vaultRef);
    const attrs: Attribute[] = Object.entries(payload.attributes).map(([name, value]) => ({
      name,
      value,
      salt: Buffer.from(payload.salts[name]!, 'hex'),
    }));

    const bundle = generateProofBundle(attrs, disclose, ATTRIBUTE_SET_ID);

    if (bundle.merkleRoot !== ledgerRoot || !verifyProofBundle(bundle)) {
      fail('ERR_PROOF_ASSEMBLY_FAILED', 'assembled proof does not match the on-ledger root');
    }
    return bundle;
  }

  #vaultRefs = new Map<string, string>();

  async #vaultRefFor(subjectId: string, version: number): Promise<string | null> {
    return this.#vaultRefs.get(`${subjectId}|${version}`) ?? this.#vaultRefs.get(subjectId) ?? null;
  }

  /** Called by register/stepUp to remember where a version's salts live. */
  rememberVaultRef(subjectId: string, version: number, vaultRef: string): void {
    this.#vaultRefs.set(`${subjectId}|${version}`, vaultRef);
    this.#vaultRefs.set(subjectId, vaultRef);
  }

  // -------------------------------------------------------------------
  // Operation 3 — Step-up / Update
  // -------------------------------------------------------------------
  async stepUp(
    ctx: TxContext,
    cnic: string,
    productId: string,
    attributes: Record<string, string | boolean | number>,
    cnicExpiryAt: string,
    reason: string,
  ): Promise<{ subjectId: string; version: number; assuranceLevel: AssuranceLevel; methodsRun: VerificationMethod[] }> {
    const subjectId = await this.subjectId(cnic);
    const policy = getPolicy(productId);
    if (policy === null) fail('ERR_INVALID_SCOPE', `unknown product ${productId}`);

    const snapshot = await this.#d.ledger.verify(ctx, subjectId);
    if (!snapshot.found) fail('ERR_SUBJECT_NOT_FOUND', 'register first');

    const existing = new Set(snapshot.methods);
    // Run ONLY the missing methods. This is the whole point: an A2 customer
    // applying for SBL runs one selfie, not the full onboarding pack.
    const missing = REQUIRED_METHODS[policy.minAssurance].filter((m) => !existing.has(m));

    const ran: VerificationMethod[] = [];
    for (const method of missing) {
      const r = await this.#d.rails.call(subjectId, method, ctx.timestamp);
      if (r.outcome) ran.push(method);
    }

    // An assertion is SUPERSEDED by verification, never combined with it.
    //
    // Stepping up from A0 means a third party's claim has now been checked
    // against NADRA. Carrying ASSERTED forward would say "this was both
    // asserted and verified", which is not a coherent statement about a single
    // attribute set — and the chaincode consistency rule rejects it outright.
    // Dropping it here means the record says what actually happened.
    const merged = [...new Set([...snapshot.methods, ...ran])] as VerificationMethod[];
    const verified = merged.filter((m) => m !== 'ASSERTED');
    const combined = (verified.length > 0 ? verified : merged).sort() as VerificationMethod[];
    const level = levelFromMethods(combined);

    const { attrs, payload } = this.#buildAttributes(attributes);
    const merkleRoot = merkleRootHex(attrs);
    const vaultRef = await this.#d.vault.write(subjectId, snapshot.version! + 1, payload);

    const r = await this.#d.ledger.update(ctx, {
      subjectId,
      expectedCurrentVersion: snapshot.version!,
      merkleRoot,
      attributeSetId: ATTRIBUTE_SET_ID,
      assuranceLevel: level,
      methods: combined,
      expiresAt: this.#expiryFor(level, ctx.timestamp),
      cnicExpiryAt,
      vaultRef,
      updateReason: reason,
    });

    this.rememberVaultRef(subjectId, r.version, vaultRef);
    return { subjectId, version: r.version, assuranceLevel: level, methodsRun: ran };
  }

  // -------------------------------------------------------------------
  // Operations 4 & 5 — Suspend / Shred
  // -------------------------------------------------------------------
  async suspend(ctx: TxContext, cnic: string, reason: string, referenceId: string) {
    return this.#d.ledger.suspend(ctx, await this.subjectId(cnic), reason, referenceId);
  }

  async reinstate(ctx: TxContext, cnic: string, reason: string, referenceId: string) {
    return this.#d.ledger.reinstate(ctx, await this.subjectId(cnic), reason, referenceId);
  }

  /**
   * Crypto-shred.
   *
   * Vault destruction happens BEFORE the ledger call. If the ledger call then
   * fails, the system is recoverable — data gone, ledger not yet marked — and
   * reconciliation completes it. The reverse order would leave the ledger
   * asserting an erasure that did not happen: a false compliance record, and
   * far worse than an incomplete one.
   */
  async shred(
    ctx: TxContext,
    cnic: string,
    reason: string,
    legalBasis: string,
  ): Promise<{ subjectId: string; vaultDestroyed: boolean; certificateRef: string }> {
    const subjectId = await this.subjectId(cnic);
    const snapshot = await this.#d.ledger.verify(ctx, subjectId);
    if (!snapshot.found) fail('ERR_SUBJECT_NOT_FOUND', 'no such subject');

    const vaultRef = await this.#vaultRefFor(subjectId, snapshot.version!);
    const vaultDestroyed = vaultRef === null ? false : await this.#d.vault.shred(vaultRef);

    const certificateRef = `SHRED-${randomUUID().slice(0, 8)}`;
    await this.#d.ledger.shred(ctx, subjectId, reason, legalBasis, certificateRef);

    return { subjectId, vaultDestroyed, certificateRef };
  }

  // -------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------
  async grantConsent(
    ctx: TxContext,
    cnic: string,
    grantedTo: string,
    purpose: string,
    scope: string[],
    expiresAt: string,
    evidenceRef: string,
  ): Promise<{ consentId: string; subjectId: string }> {
    const subjectId = await this.subjectId(cnic);
    const consentId = randomUUID();
    await this.#d.ledger.consent(
      ctx,
      { consentId, subjectId, grantedTo, purpose, scope, expiresAt, evidenceRef },
      KNOWN_ATTRIBUTES,
      // Ceiling: no policy anywhere can disclose more than this, so a broader
      // consent could never be honoured and must not be recorded (SEC-10).
      MAX_DISCLOSABLE_ATTRIBUTES,
    );
    return { consentId, subjectId };
  }

  async revokeConsent(ctx: TxContext, cnic: string, grantedTo: string, consentId: string, reason: string) {
    return this.#d.ledger.revoke(ctx, await this.subjectId(cnic), grantedTo, consentId, reason);
  }

  // -------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------
  async versionChain(ctx: TxContext, cnic: string) {
    return this.#d.ledger.chain(ctx, await this.subjectId(cnic));
  }

  async auditTrail(ctx: TxContext, cnic: string): Promise<AuditEvent[]> {
    return this.#d.ledger.audit(ctx, await this.subjectId(cnic));
  }

  // -------------------------------------------------------------------
  // Directory reads — keyed by subject id, never by CNIC
  // -------------------------------------------------------------------
  //
  // The operations screens address a customer by subject id, because a CNIC in
  // a URL is a citizen's primary identifier in browser history, in referrer
  // headers and in every access log between here and the browser. These
  // methods exist so the read path never needs the CNIC at all.

  /** Every subject, for the customer directory. */
  async listSubjects(): Promise<SubjectSummary[]> {
    const list = this.#d.ledger.listSubjects;
    if (list === undefined) {
      fail(
        'ERR_INVALID_SCOPE',
        'this ledger adapter cannot enumerate subjects; the directory needs a paged chaincode query',
      );
    }
    return list.call(this.#d.ledger);
  }

  /** One subject's current record, without going through a CNIC. */
  async recordFor(ctx: TxContext, subjectId: string) {
    return this.#d.ledger.verify(ctx, subjectId);
  }

  async versionChainFor(ctx: TxContext, subjectId: string) {
    return this.#d.ledger.chain(ctx, subjectId);
  }

  async auditTrailFor(ctx: TxContext, subjectId: string): Promise<AuditEvent[]> {
    return this.#d.ledger.audit(ctx, subjectId);
  }

  async consentsFor(subjectId: string): Promise<ConsentRecord[]> {
    const list = this.#d.ledger.listConsents;
    if (list === undefined) return [];
    return list.call(this.#d.ledger, subjectId);
  }

  /**
   * Employer bulk lookup — the headline demo.
   *
   * Splits an uploaded CNIC list into "activate now" and "needs onboarding".
   *
   * PRIVACY NOTE [OPEN-D]: this leaks, to an employer, whether a given CNIC is
   * already verified at ABHI. That is acceptable only for CNICs the employer
   * has a demonstrated employment relationship with. Production must
   * rate-limit per employer and alert on volume anomalies (attack scenario S-5).
   */
  async employerBulkLookup(
    ctx: TxContext,
    cnics: readonly string[],
    productId = 'EMPLOYER_BULK',
    /** Required when an employment register is configured. */
    employerId?: string,
  ): Promise<{
    total: number;
    activateNow: string[];
    needsOnboarding: string[];
    denied: string[];
    invalid: string[];
    unauthorised: string[];
  }> {
    const policy = getPolicy(productId);
    if (policy === null) fail('ERR_INVALID_SCOPE', `unknown product ${productId}`);

    const activateNow: string[] = [];
    const needsOnboarding: string[] = [];
    const denied: string[] = [];
    const invalid: string[] = [];
    let unauthorised: string[] = [];

    // SEC-05 — restrict to CNICs the employer demonstrably employs. CNICs
    // outside the roster are never looked up, so the response carries no
    // information about whether they exist at ABHI.
    let candidates: readonly string[] = cnics;
    if (this.#d.employment !== undefined) {
      if (employerId === undefined) {
        fail('ERR_INVALID_SCOPE', 'employerId is required when an employment register is configured');
      }
      const parsed = cnics.map((raw) => {
        try {
          return { raw, normalised: normaliseCnic(raw) };
        } catch {
          return { raw, normalised: null };
        }
      });
      const split = this.#d.employment.partition(employerId, parsed);
      candidates = split.permitted;
      unauthorised = split.unauthorised;
    }

    for (const cnic of candidates) {
      let subjectId: string;
      try {
        subjectId = await this.subjectId(cnic);
      } catch {
        invalid.push(cnic);
        continue;
      }

      const snapshot = await this.#d.ledger.verify(ctx, subjectId);
      const record: KYCRecord | null = snapshot.found
        ? ({
            assuranceLevel: snapshot.assuranceLevel!,
            methods: snapshot.methods,
            status: snapshot.status!,
            verifiedAt: snapshot.verifiedAt!,
            cnicExpiryAt: snapshot.cnicExpiryAt!,
          } as KYCRecord)
        : null;

      const d = decide(record, policy, ctx.timestamp);
      if (d.outcome === 'ALLOW') activateNow.push(cnic);
      else if (d.outcome === 'DENY') denied.push(cnic);
      else needsOnboarding.push(cnic);
    }

    return { total: cnics.length, activateNow, needsOnboarding, denied, invalid, unauthorised };
  }

  get metrics() {
    return {
      rails: this.#d.rails.metrics,
      ecibCalls: this.#d.ecib.calls,
      vaultDecrypts: this.#d.vault.decryptCount,
      ledgerMode: this.#d.ledger.mode,
    };
  }
}

function methodToAttribute(method: VerificationMethod): string {
  switch (method) {
    case 'VERISYS':
      return 'verisys_match';
    case 'DOC_AUTH':
      return 'document_authenticity_pass';
    case 'BIOMETRIC_1TO1':
      return 'biometric_match';
    case 'LIVENESS':
      return 'liveness_pass';
    default:
      return 'asserted';
  }
}
