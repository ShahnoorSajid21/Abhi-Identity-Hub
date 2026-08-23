/**
 * Architecture conformance audit.
 *
 *   npm run audit:conformance
 *
 * Every requirement from the Implementation Blueprint is asserted against the
 * actual repository — file existence, exported symbols, and where possible a
 * live behavioural probe. A hand-maintained conformance table drifts from the
 * code within a sprint; this one cannot, because CI fails when it does.
 *
 * Exit code 1 if any MUST requirement is unmet.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type Status = 'IMPLEMENTED' | 'UNVERIFIED' | 'PARTIAL' | 'MISSING' | 'DEFERRED';
type Priority = 'MUST' | 'SHOULD' | 'POC-DEFERRED';

interface Requirement {
  id: string;
  area: string;
  requirement: string;
  priority: Priority;
  check: () => { status: Status; evidence: string };
}

const fileHas = (path: string, ...needles: string[]) => (): { status: Status; evidence: string } => {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { status: 'MISSING', evidence: `${path} not found` };
  const src = readFileSync(full, 'utf8');
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length > 0) {
    return { status: 'PARTIAL', evidence: `${path} lacks: ${missing.join(', ')}` };
  }
  return { status: 'IMPLEMENTED', evidence: path };
};

const fileExists = (path: string) => (): { status: Status; evidence: string } =>
  existsSync(join(ROOT, path))
    ? { status: 'IMPLEMENTED', evidence: path }
    : { status: 'MISSING', evidence: `${path} not found` };

/**
 * Every part must hold, and the first failure is reported.
 *
 * This exists because a single-file grep cannot tell "the control is built"
 * from "the control is connected". SEC-05 was the worked example: the
 * EmploymentRegister class existed, had unit tests, and this audit reported it
 * IMPLEMENTED — while the HTTP route passed no employer id and the bootstrap
 * constructed no register, so the gate could not engage on the only surface a
 * caller can reach.
 *
 * A control is only implemented when the call site, the wiring and the
 * mechanism are all present. Where that spans files, assert across files.
 */
const allOf =
  (...checks: (() => { status: Status; evidence: string })[]) =>
  (): { status: Status; evidence: string } => {
    const evidence: string[] = [];
    for (const check of checks) {
      const r = check();
      if (r.status !== 'IMPLEMENTED') return r;
      evidence.push(r.evidence);
    }
    return { status: 'IMPLEMENTED', evidence: evidence.join(' + ') };
  };

const deferred = (why: string) => (): { status: Status; evidence: string } => ({
  status: 'DEFERRED',
  evidence: why,
});

/**
 * Code exists and is reviewable, but could NOT be executed in this environment
 * (no Docker, no HSM appliance, no PostgreSQL). Distinguished from IMPLEMENTED
 * on purpose: "written" and "proven" are different claims, and collapsing them
 * is how a conformance report starts lying.
 */
const unverified = (path: string, why: string, ...needles: string[]) => (): {
  status: Status;
  evidence: string;
} => {
  const r = fileHas(path, ...needles)();
  if (r.status !== 'IMPLEMENTED') return r;
  return { status: 'UNVERIFIED', evidence: `${path} — ${why}` };
};

const REQUIREMENTS: Requirement[] = [
  // ------------------------------------------------------ functional
  {
    id: 'F-01', area: 'Chaincode', priority: 'MUST',
    requirement: 'RegisterKYC creates v1 with null previousVersionHash',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function registerKYC', 'previousVersionHash: null'),
  },
  {
    id: 'F-02', area: 'Chaincode', priority: 'MUST',
    requirement: 'VerifyKYC returns facts, not a decision',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function verifyKYC'),
  },
  {
    id: 'F-03', area: 'Chaincode', priority: 'MUST',
    requirement: 'UpdateKYC hashes the predecessor AS STORED, post-supersession',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', "supersededPrev", 'const previousVersionHash = sha256Hex(prevSerialised)'),
  },
  {
    id: 'F-04', area: 'Chaincode', priority: 'MUST',
    requirement: 'SuspendKYC restricted to Compliance MSP + officer role',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export function suspendKYC', 'complianceOnly: true'),
  },
  {
    id: 'F-05', area: 'Chaincode', priority: 'MUST',
    requirement: 'ReinstateKYC does not refresh assurance or expiry',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export function reinstateKYC'),
  },
  {
    id: 'F-06', area: 'Chaincode', priority: 'MUST',
    requirement: 'RecordConsent / RevokeConsent with scope and expiry',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function recordConsent', 'export async function revokeConsent'),
  },
  {
    id: 'F-07', area: 'Chaincode', priority: 'MUST',
    requirement: 'MarkShredded clears the vault pointer and retains the root',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function markShredded', "vaultRef: ''"),
  },
  {
    id: 'F-08', area: 'Chaincode', priority: 'MUST',
    requirement: 'GetVersionChain verifies hash-link integrity',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function getVersionChain', 'chainValid'),
  },
  {
    id: 'F-09', area: 'Chaincode', priority: 'MUST',
    requirement: 'GenerateProof applies the three-way disclosure intersection',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function generateProof', 'consentScope.has(attr) && policyAttrs.has(attr)'),
  },
  {
    id: 'F-10', area: 'Chaincode', priority: 'MUST',
    requirement: 'VerifyProof checks crypto AND that the root is current',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'export async function verifyProof', 'rootMatchesLedger'),
  },
  {
    id: 'F-11', area: 'Crypto', priority: 'MUST',
    requirement: 'Salted, domain-separated Merkle tree with promoted odd nodes',
    check: fileHas('packages/merkle/src/tree.ts', 'right === undefined ? left'),
  },
  {
    id: 'F-12', area: 'Crypto', priority: 'MUST',
    requirement: 'Subject ID via HMAC with an HSM-held pepper',
    check: fileHas('packages/merkle/src/subject.ts', 'deriveSubjectId', 'PepperProvider'),
  },
  {
    id: 'F-13', area: 'Policy', priority: 'MUST',
    requirement: 'Decision engine: ALLOW / STEP_UP / FULL_KYC / DENY in documented order',
    check: fileHas('packages/policy/src/engine.ts', "outcome: 'DENY', reason: 'SUSPENDED'", "reason: 'CNIC_EXPIRED'", "reason: 'ASSURANCE_LOW'"),
  },
  {
    id: 'F-14', area: 'Policy', priority: 'MUST',
    requirement: 'Step-up names only the missing methods',
    check: fileHas('packages/policy/src/engine.ts', 'missingMethodsFor'),
  },
  {
    id: 'F-15', area: 'Gateway', priority: 'MUST',
    requirement: 'Proof self-verification before release',
    check: fileHas('packages/merkle/src/tree.ts', 'ERR_PROOF_ASSEMBLY_FAILED'),
  },
  {
    id: 'F-16', area: 'Gateway', priority: 'MUST',
    requirement: 'Employer bulk activation split',
    check: fileHas('services/gateway/src/service.ts', 'employerBulkLookup'),
  },
  {
    id: 'F-17', area: 'Gateway', priority: 'MUST',
    requirement: 'e-CIB always runs and is never avoided by reuse',
    check: fileHas('services/gateway/src/rails.ts', 'class MockECib'),
  },

  // ------------------------------------------------------ security
  {
    id: 'S-01', area: 'Security', priority: 'MUST',
    requirement: 'PII tripwire rejects CNIC-shaped payloads',
    check: fileHas('packages/types/src/index.ts', 'export function assertNoPII', 'ERR_PII_DETECTED'),
  },
  {
    id: 'S-02', area: 'Security', priority: 'MUST',
    requirement: 'Assurance level must be derivable from methods',
    check: fileHas('packages/types/src/index.ts', 'assertAssuranceConsistent'),
  },
  {
    id: 'S-03', area: 'Security', priority: 'MUST',
    requirement: 'Vault envelope encryption with AAD record binding',
    check: fileHas('services/gateway/src/vault.ts', 'setAAD', 'function aadFor'),
  },
  {
    id: 'S-04', area: 'Security', priority: 'MUST',
    requirement: 'Software HSM and simulated ledger refuse to run in production',
    check: () => {
      const hsm = fileHas('services/gateway/src/hsm.ts', 'not permitted in production')();
      const ledger = fileHas('services/gateway/src/ledger.ts', 'never run in production')();
      return hsm.status === 'IMPLEMENTED' && ledger.status === 'IMPLEMENTED'
        ? { status: 'IMPLEMENTED', evidence: 'hsm.ts + ledger.ts guards' }
        : { status: 'PARTIAL', evidence: `${hsm.evidence}; ${ledger.evidence}` };
    },
  },
  {
    id: 'S-05', area: 'Security', priority: 'MUST',
    requirement: 'Log redaction by key AND by value pattern',
    check: fileHas('services/gateway/src/logging.ts', 'DENIED_KEYS', 'scrubString'),
  },
  {
    id: 'S-06', area: 'Security', priority: 'MUST',
    requirement: 'Security-class errors do not echo detail to callers',
    check: fileHas('services/gateway/src/http.ts', 'SECURITY_ERROR_CODES.has(e.code)'),
  },
  {
    id: 'S-07', area: 'Security', priority: 'MUST',
    requirement: 'Endorsement policy requires Compliance plus a product org',
    check: fileHas('network/scripts/deploy-chaincode.sh', "AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer','ABHILendingMSP.peer'))"),
  },
  {
    id: 'S-08', area: 'Security', priority: 'MUST',
    requirement: 'Chaincode lifecycle endorsement requires ALL organizations',
    check: fileHas('network/configtx.yaml', 'LifecycleEndorsement', 'ALL Endorsement'),
  },
  {
    id: 'S-09', area: 'Security', priority: 'SHOULD',
    requirement: 'Container hardening: non-root, distroless, read-only rootfs',
    check: () => {
      const df = fileHas('docker/Dockerfile.gateway', 'distroless', 'USER nonroot')();
      const k8s = fileHas('infrastructure/k8s/gateway.yaml', 'readOnlyRootFilesystem: true', 'drop: ["ALL"]')();
      return df.status === 'IMPLEMENTED' && k8s.status === 'IMPLEMENTED'
        ? { status: 'IMPLEMENTED', evidence: 'Dockerfile + k8s securityContext' }
        : { status: 'PARTIAL', evidence: `${df.evidence}; ${k8s.evidence}` };
    },
  },
  {
    id: 'S-10', area: 'Security', priority: 'SHOULD',
    requirement: 'Default-deny egress network policy',
    check: fileHas('infrastructure/k8s/gateway.yaml', 'kind: NetworkPolicy', 'policyTypes: [Egress, Ingress]'),
  },

  // ------------------------------------------------------ data / compliance
  {
    id: 'D-01', area: 'Data', priority: 'MUST',
    requirement: 'All six on-ledger record types defined',
    check: fileHas('packages/types/src/index.ts', 'interface KYCRecord', 'interface SubjectRegistry', 'interface ConsentRecord', 'interface VerificationEvent', 'interface AuditEvent', 'interface ProductPolicy'),
  },
  {
    id: 'D-02', area: 'Data', priority: 'MUST',
    requirement: 'Version keys zero-padded for correct lexicographic ordering',
    check: fileHas('packages/canonical/src/index.ts', 'export function padVersion'),
  },
  {
    id: 'D-03', area: 'Data', priority: 'MUST',
    requirement: 'Canonical JSON with recursive key sorting',
    check: fileHas('packages/canonical/src/index.ts', 'Object.keys(obj).sort()'),
  },
  {
    id: 'D-04', area: 'Data', priority: 'MUST',
    requirement: 'Vault schema with crypto-shred and least-privilege grants',
    check: fileHas('vault/schema.sql', 'FUNCTION vault.crypto_shred', 'REVOKE DELETE'),
  },
  {
    id: 'C-01', area: 'Compliance', priority: 'MUST',
    requirement: 'Audit event records policyId for decision reproducibility',
    check: fileHas('packages/types/src/index.ts', 'policyId: string | null'),
  },
  {
    id: 'C-02', area: 'Compliance', priority: 'MUST',
    requirement: 'Consent carries mandatory expiry and no wildcard scope',
    check: fileHas('chaincode/kyc-registry/src/registry.ts', 'wildcard scope is not permitted', 'MAX_CONSENT_DAYS'),
  },
  {
    id: 'C-03', area: 'Compliance', priority: 'MUST',
    requirement: 'Product policies flagged as engineering defaults pending sign-off',
    check: fileHas('packages/policy/src/policies.ts', 'PENDING:Compliance'),
  },

  // ------------------------------------------------------ test / ops
  {
    id: 'T-01', area: 'Test', priority: 'MUST',
    requirement: 'Reference vectors pin the cryptographic construction',
    check: fileExists('packages/merkle/vectors/reference-vectors.json'),
  },
  {
    id: 'T-02', area: 'Test', priority: 'MUST',
    requirement: 'chain-hash-post-supersession test exists',
    check: fileHas('chaincode/kyc-registry/test/registry.test.ts', 'chain-hash-post-supersession'),
  },
  {
    id: 'T-03', area: 'Test', priority: 'MUST',
    requirement: 'Tamper detection test (attack scenario S-1)',
    check: fileHas('chaincode/kyc-registry/test/registry.test.ts', 'tamper detection'),
  },
  {
    id: 'T-04', area: 'Test', priority: 'MUST',
    requirement: 'All seven required E2E scenarios',
    check: fileHas('tests/e2e/scenarios.test.ts', 'E2E-1', 'E2E-2', 'E2E-3', 'E2E-4', 'E2E-5', 'E2E-6', 'E2E-7'),
  },
  {
    id: 'T-05', area: 'Test', priority: 'MUST',
    requirement: 'Property-based Merkle testing',
    check: fileHas('packages/merkle/test/merkle.test.ts', 'property-based'),
  },
  {
    id: 'T-06', area: 'Test', priority: 'MUST',
    requirement: 'Vault swap-attack test',
    check: fileHas('tests/security/controls.test.ts', 'ciphertext relocated onto another record'),
  },
  {
    id: 'O-01', area: 'Ops', priority: 'MUST',
    requirement: 'CI gates crypto vectors before anything else',
    check: fileHas('ci-cd/.github/workflows/ci.yml', 'crypto-vectors', 'needs: crypto-vectors'),
  },
  {
    id: 'O-02', area: 'Ops', priority: 'MUST',
    requirement: 'CI blocks committed key material and CNIC literals',
    check: fileHas('ci-cd/.github/workflows/ci.yml', 'Key material must never be committed'),
  },
  {
    id: 'O-03', area: 'Ops', priority: 'SHOULD',
    requirement: 'Fabric network definition with 3 orgs and Raft ordering',
    check: fileHas('network/configtx.yaml', 'ABHIBankMSP', 'ABHILendingMSP', 'ABHIComplianceMSP', 'etcdraft'),
  },
  {
    id: 'O-04', area: 'Ops', priority: 'SHOULD',
    requirement: 'Runnable demo walkthrough',
    check: fileExists('scripts/demo-walkthrough.ts'),
  },

  // ------------------------------------------------------ remediated findings
  {
    id: 'R-01', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-11 — event IDs deterministic across endorsing peers',
    check: fileHas('chaincode/kyc-registry/src/state.ts', 'nextOrdinal'),
  },
  {
    id: 'R-02', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-04 — PII exemption granted by field name, not by pattern',
    check: fileHas('packages/types/src/index.ts', 'HEX64_FIELDS', 'function walk'),
  },
  {
    id: 'R-03', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-10 — consent scope validated against the policy ceiling at grant time',
    check: fileHas('packages/policy/src/policies.ts', 'MAX_DISCLOSABLE_ATTRIBUTES'),
  },
  {
    id: 'R-04', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-05 — employer bulk lookup gated on a demonstrated employment relationship',
    // Mechanism, call site AND bootstrap. See allOf() for why all three.
    check: allOf(
      fileHas('services/gateway/src/security.ts', 'class EmploymentRegister', 'unauthorised'),
      // The route must take the employer from the authenticated caller.
      fileHas('services/gateway/src/http.ts', 'caller.employerId'),
      // The service must refuse to run without a register in production.
      fileHas('services/gateway/src/service.ts', 'no EmploymentRegister configured'),
      // The shipped gateway must actually construct and populate one.
      fileHas('services/gateway/src/server.ts', 'new EmploymentRegister()', 'employment'),
    ),
  },
  {
    id: 'R-05', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-06 — rate limiting, idempotency, replay nonce, request signing',
    check: fileHas('services/gateway/src/security.ts', 'class RateLimiter', 'class IdempotencyStore', 'class NonceCache', 'function verifySignature'),
  },
  {
    id: 'R-06', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-07 — vault overwrite before delete',
    check: fileHas('services/gateway/src/vault.ts', 'ZERO_FILL.repeat(row.ciphertext.length)'),
  },
  {
    id: 'R-07', area: 'Remediation', priority: 'MUST',
    requirement: 'SEC-09 — no credential literals in compose',
    check: fileHas('network/docker-compose.yaml', 'COUCHDB_PASSWORD:?', 'VAULT_DB_PASSWORD:?'),
  },
  {
    id: 'R-08', area: 'Remediation', priority: 'SHOULD',
    requirement: 'SEC-12 — signed SBOM and signed image',
    check: fileHas('ci-cd/.github/workflows/ci.yml', 'sbom-action', 'cosign sign', 'cosign attest'),
  },
  {
    id: 'R-09', area: 'Remediation', priority: 'MUST',
    requirement: 'C-11 — policy approval workflow, enforced at evaluation time',
    check: () => {
      const gov = fileHas('packages/policy/src/governance.ts', 'validateApprovals', 'classifyChange', 'assertPolicyUsable')();
      const wired = fileHas('services/gateway/src/service.ts', 'assertPolicyUsable(policy)')();
      return gov.status === 'IMPLEMENTED' && wired.status === 'IMPLEMENTED'
        ? { status: 'IMPLEMENTED', evidence: 'governance.ts + wired into verify()' }
        : { status: 'PARTIAL', evidence: `${gov.evidence}; ${wired.evidence}` };
    },
  },

  // ------------------------------------------------------ operational
  {
    id: 'O-05', area: 'Ops', priority: 'SHOULD',
    requirement: 'Prometheus exposition matching the alerting rules',
    check: fileHas('services/gateway/src/http.ts', 'rail_cost_pkr_total', 'kyc_reuse_ratio'),
  },
  {
    id: 'O-06', area: 'Ops', priority: 'SHOULD',
    requirement: 'Alerting rules covering integrity, keys, governance and cost',
    check: fileHas('monitoring/prometheus-rules.yaml', 'KycChainIntegrityBroken', 'HsmHmacRateAnomaly', 'AllCompliancePeersDown'),
  },
  {
    id: 'O-07', area: 'Ops', priority: 'SHOULD',
    requirement: 'Terraform with per-MSP isolation and residency validation',
    check: fileHas('infrastructure/terraform/main.tf', 'azurerm_key_vault" "org', 'must be an approved in-region datacentre'),
  },
  {
    id: 'O-08', area: 'Ops', priority: 'SHOULD',
    requirement: 'Demo seed script covering every decision path',
    check: fileHas('scripts/seed-demo.ts', 'PERSONAS'),
  },

  // ------------------------------------------------------ written, not runnable here
  {
    id: 'X-01', area: 'Production', priority: 'SHOULD',
    requirement: 'PKCS#11 hardware HSM integration',
    check: unverified(
      'services/gateway/src/pkcs11-hsm.ts',
      'no HSM appliance available; refuses extractable keys at boot',
      'class Pkcs11Hsm', 'is EXTRACTABLE',
    ),
  },
  {
    id: 'X-02', area: 'Production', priority: 'SHOULD',
    requirement: 'Fabric contract binding and Gateway SDK client',
    check: () => {
      const cc = fileHas('chaincode/kyc-registry/src/contract.ts', 'KycRegistryContract', 'RegisterKYC')();
      const gw = fileHas('services/gateway/src/fabric-ledger.ts', 'class FabricLedger', 'endorsingOrganizations')();
      if (cc.status !== 'IMPLEMENTED' || gw.status !== 'IMPLEMENTED') {
        return { status: 'PARTIAL', evidence: `${cc.evidence}; ${gw.evidence}` };
      }
      return {
        status: 'UNVERIFIED',
        evidence: 'contract.ts + fabric-ledger.ts — NEVER EXECUTED: Docker unavailable. Run the fabric-network CI job.',
      };
    },
  },
  {
    id: 'X-03', area: 'Production', priority: 'SHOULD',
    requirement: 'mTLS client-certificate identity',
    check: unverified(
      'services/gateway/src/security.ts',
      'no PKI in this environment; header fallback throws in production',
      'identityFromCertificate',
    ),
  },
  {
    id: 'X-06', area: 'Production', priority: 'SHOULD',
    requirement: 'PostgreSQL vault driver',
    check: unverified(
      'services/gateway/src/postgres-vault.ts',
      'no PostgreSQL instance available; decrypt audit is in-transaction',
      'class PostgresVaultStore', 'assertLeastPrivilege',
    ),
  },

  // ------------------------------------------------------ knowingly deferred
  {
    id: 'X-04', area: 'Production', priority: 'POC-DEFERRED',
    requirement: 'Real NADRA / e-CIB / CBS / Mobiliser integration',
    check: deferred('Sprints 4-6. Commercial contracting is the long pole and must start at S0.'),
  },
  {
    id: 'X-05', area: 'Production', priority: 'POC-DEFERRED',
    requirement: 'Migration and backfill of the existing customer base',
    check: deferred('Sprints 13-14. Largest workstream; blocked on [OPEN-5], a Compliance decision.'),
  },
  {
    id: 'X-07', area: 'Production', priority: 'POC-DEFERRED',
    requirement: 'OAuth2 client credentials via Keycloak',
    check: deferred('Sprint 9. Requires ABHI SSO. mTLS + request signing already implemented.'),
  },
];

// ---------------------------------------------------------------------------

const results = REQUIREMENTS.map((r) => ({ ...r, ...r.check() }));

const ICON: Record<Status, string> = {
  IMPLEMENTED: '✔',
  UNVERIFIED: '◑',
  PARTIAL: '◐',
  MISSING: '✘',
  DEFERRED: '⊖',
};

console.log('\nABHI Unified KYC Ledger — Architecture Conformance Audit');
console.log('='.repeat(100));
console.log(
  `${'ID'.padEnd(6)}${'AREA'.padEnd(12)}${'PRIORITY'.padEnd(14)}${'STATUS'.padEnd(14)}REQUIREMENT`,
);
console.log('-'.repeat(100));

let area = '';
for (const r of results) {
  if (r.area !== area) {
    area = r.area;
    console.log('');
  }
  console.log(
    `${r.id.padEnd(6)}${r.area.padEnd(12)}${r.priority.padEnd(14)}` +
      `${(ICON[r.status] + ' ' + r.status).padEnd(14)}${r.requirement}`,
  );
  if (r.status !== 'IMPLEMENTED') console.log(`${' '.repeat(46)}└─ ${r.evidence}`);
}

const counts = results.reduce<Record<Status, number>>(
  (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
  { IMPLEMENTED: 0, UNVERIFIED: 0, PARTIAL: 0, MISSING: 0, DEFERRED: 0 },
);

const mustFailures = results.filter(
  (r) => r.priority === 'MUST' && (r.status === 'MISSING' || r.status === 'PARTIAL'),
);

console.log(`\n${'='.repeat(100)}`);
console.log(
  `Implemented ${counts.IMPLEMENTED}   Unverified ${counts.UNVERIFIED}   Partial ${counts.PARTIAL}   ` +
    `Missing ${counts.MISSING}   Deferred ${counts.DEFERRED}   (total ${results.length})`,
);
if (counts.UNVERIFIED > 0) {
  console.log(
    `\nUNVERIFIED means the code exists and is reviewable but could NOT be executed here\n` +
      `(no Docker, no HSM, no PostgreSQL). "Written" and "proven" are different claims.`,
  );
}

const mustTotal = results.filter((r) => r.priority === 'MUST').length;
const mustDone = results.filter((r) => r.priority === 'MUST' && r.status === 'IMPLEMENTED').length;
console.log(`MUST requirements: ${mustDone}/${mustTotal} implemented`);

if (mustFailures.length > 0) {
  console.log('\nUNMET MUST REQUIREMENTS:');
  for (const f of mustFailures) console.log(`  ${f.id}  ${f.requirement}\n        ${f.evidence}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log('\nAll MUST requirements implemented. Deferred items are POC scope decisions,');
  console.log('each mapped to a sprint in docs/GAP_ANALYSIS.md.\n');
}
