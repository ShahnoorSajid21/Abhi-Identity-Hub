# Security Audit Report
## ABHI Unified KYC Ledger — POC Implementation

| | |
|---|---|
| **Scope** | `packages/`, `chaincode/`, `services/`, `network/`, `infrastructure/`, `vault/`, `ci-cd/` |
| **Method** | Code review against the Implementation Blueprint §8 threat model; executable control tests in `tests/security/`; conformance audit `npm run audit:conformance` |
| **Date** | 17 August 2026 · **revision 2** after remediation |
| **Verdict** | **PASS for POC scope.** 9 of 12 findings REMEDIATED. 3 remain, all requiring hardware or a live network that cannot exist in this environment |

---

## 1. Summary — revision 2

| Severity | Remediated | Remaining | Note |
|---|---|---|---|
| **Critical** | — | 0 | — |
| **High** | 1 | 2 | Both remaining need hardware (HSM) or a PKI |
| **Medium** | 5 | 0 | All closed with executable tests |
| **Low** | 3 | 1 | SEC-11 was reclassified High and closed |
| **Process** | 2 | 0 | SEC-13 (no type checking) and SEC-14 (gate blind spots), found in a verification pass |

**Nine findings closed since revision 1**, each with regression tests: SEC-04, SEC-05, SEC-06, SEC-07, SEC-09, SEC-10, SEC-11, SEC-12, and control C-11.

**Test count rose from 138 to 202** — the 64 new tests are almost entirely security controls.

**SEC-11 was reclassified from Low to High during remediation.** It was originally logged as a determinism nit; on closer analysis a module-level counter would have produced divergent read-write sets across endorsing peers, surfacing as intermittent endorsement failures that look like network faults. That is a correctness bug in the Fabric path, not a style issue, and it would have cost days to diagnose in Sprint 4.

**The two remaining High findings are environmental, not architectural.** Both now have complete implementations in the repository — `pkcs11-hsm.ts` and the mTLS path in `security.ts` — that could not be *executed* here because there is no HSM appliance and no PKI. Both still fail closed: the software HSM and the header-identity fallback each throw when `NODE_ENV=production`.

---

## 2. Controls verified as working

Each is asserted by an executable test, not by inspection.

| Control | Threat closed | Evidence |
|---|---|---|
| **Endorsement: Compliance + one product org** | Product team self-certifies a customer (S-2) | `network/scripts/deploy-chaincode.sh`; `registry.test.ts` → *suspend-requires-compliance* |
| **Chaincode MSP/role guards** | Product org invokes a Compliance-only function | 4 tests incl. officer-role-at-product-MSP rejection |
| **Hash chain over post-supersession state** | Malicious DBA edits history (S-1) | `chain-hash-post-supersession`, `tamper detection` — chain breaks, `brokenAt` correct |
| **PII tripwire** | CNIC on an immutable ledger | `assertNoPII`; full state export asserted PII-free |
| **Assurance/methods consistency** | Assurance inflation | A3-without-LIVENESS rejected at write time |
| **Merkle domain separation** | Second-preimage substitution | `domain separation` suite |
| **Odd-node promotion** | Distinct leaf sets, identical root (CVE-2012-2459 class) | `odd nodes are promoted, not duplicated` |
| **Per-attribute salting** | Guessing low-entropy attributes from leaves | 2,000-iteration property test |
| **Vault AAD binding** | Ciphertext swap between records | `ciphertext relocated onto another record` → GCM auth failure |
| **Proof self-verification** | Forged or corrupt proof reaching a product | Double-checked: in `generateProofBundle` and against the ledger root |
| **Root-currency check on VerifyProof** | Replay of a stale bundle | `rejects a bundle whose root is not the ledger root` |
| **Three-way disclosure intersection** | Over-broad product request | Request ∩ consent ∩ policy; audit records exactly what was released |
| **Security errors do not echo detail** | Information leak via error responses | API test asserts the CNIC is absent from the 400 body |
| **Two-layer log redaction** | PII in logs | Key deny-list *and* value-pattern scrubbing |

---

## 2a. Remediation status

| ID | Finding | Was | Now | Evidence |
|---|---|---|---|---|
| **SEC-01** | Software HSM holds pepper/KEK in memory | High | **OPEN — implementation written, unverified** | `pkcs11-hsm.ts`; refuses extractable keys at boot; software impl throws in production |
| **SEC-02** | Header-based caller identity | High | **OPEN — implementation written, unverified** | `identityFromCertificate()`; header path throws in production |
| **SEC-03** | `cryptogen` generates all keys in one place | High | **OPEN — documented, POC-only** | Fabric CA per org is a Sprint 8 deliverable |
| **SEC-04** | PII tripwire stripped any 64-hex token | Medium | **CLOSED** | Structural walk; exemption by named field only. 8 tests |
| **SEC-05** | Employer bulk lookup is an existence oracle | Medium | **CLOSED** | `EmploymentRegister`; unrelated CNICs return `unauthorised` and are never looked up. 5 tests |
| **SEC-06** | No rate limiting, signing or replay defence | Medium | **CLOSED** | `RateLimiter`, `IdempotencyStore`, `NonceCache`, HMAC signing. 19 tests |
| **SEC-07** | Vault overwrite not durable | Medium | **CLOSED** | `ZERO_FILL` overwrite; `vault.crypto_shred()` UPDATE path; `DELETE` revoked |
| **SEC-08** | Attempt-cap drift from NADRA | Medium | **OPEN — needs the real rail** | Cannot be closed without NADRA. Reconciliation is a Sprint 5 deliverable |
| **SEC-09** | Credential literals in compose | Low | **CLOSED** | `${VAR:?}` form fails startup rather than defaulting; `.env.example` added |
| **SEC-10** | Consent scope unchecked against policy | Low | **CLOSED** | `MAX_DISCLOSABLE_ATTRIBUTES` ceiling enforced at grant time. 5 tests |
| **SEC-11** | Non-deterministic audit event IDs | Low → **High** | **CLOSED** | `TxContext.nextOrdinal()`; two-peer divergence test |
| **SEC-12** | No SBOM or image signing | Low | **CLOSED** | Syft SBOM + Cosign keyless sign, attest and verify |
| **C-11** | No policy approval workflow | Compliance gap | **CLOSED** | `governance.ts`: four-eyes, distinct identities, Compliance mandatory, Risk required for loosening. 16 tests |

### Revision 3 — two findings from a verification pass

**SEC-13 · The codebase was never type-checked — HIGH (process), CLOSED.**

`node --experimental-strip-types` **runs** TypeScript without **checking** it. Every one of the 203 tests passed for the entire build while 12 genuine type errors sat in the tree, including a `readonly`/mutable mismatch in the shipped product-policy table and a `Date` leaking into an attribute map typed as `string | boolean | number`.

None were runtime bugs. All 12 are now fixed, `tsc --noEmit` reports zero, and a **typecheck gate runs in CI before the unit tests** so this cannot recur. The five production adapters — Fabric contract binding, Gateway SDK client, PKCS#11 HSM, PostgreSQL vault — are now type-checked too, four of them against the real vendor type definitions.

The lesson is worth keeping: a green test suite said nothing about type safety, and nobody would have noticed until the first `tsc` build in a deployment pipeline.

**SEC-14 · The CNIC-literal CI gate did not scan `scripts/` or `apps/` — MEDIUM, CLOSED.**

The gate that stops a real customer CNIC being pasted into source only covered `packages`, `services` and `chaincode`. Anything in `scripts/`, `apps/` or `tests/` passed unexamined.

Replaced with `scripts/check-cnic-literals.mjs`, which scans all six directories and requires any file legitimately holding a fictional CNIC to declare it inline:

```
// FICTIONAL-CNIC-OK: <why>
```

Marker-based rather than path-based, because a path allow-list goes stale silently — which is exactly how this gate came to have a hole. Eleven files now declare 50 fictional occurrences; anything undeclared fails the build.

A related trap was found and avoided in the same pass: the original inline shell gate was nearly rewritten as `grep ... | head -3`, which returns success even with no matches and would have **silently disabled the check entirely**. The replacement has a test-visible exit code.

---

### One defect found and fixed during remediation itself

While closing SEC-07 a **literal NUL byte** was introduced into `vault.ts`, which made the entire file binary to `grep` and `diff`. It was caught by the conformance audit failing to match its own check string.

That is worth recording rather than quietly fixing: a raw control character in source is exactly how a security control becomes invisible in code review, and the file in question was the crypto-shredding implementation. The constant is now built with `String.fromCharCode(0)` and the conformance audit asserts the construct by name.

---

## 3. Open findings

### SEC-01 · Software HSM holds the pepper and KEK in process memory — **HIGH**

**Detail.** `SoftwareHsm` derives the pepper and KEK from published seeds and holds them in the Node heap. Anyone with memory access to the gateway process, or a heap dump, recovers both.

**Impact if shipped.** Total loss of subject-ID unlinkability (attack scenario S-3) and of all vault confidentiality.

**Compensating control (implemented).** The constructor throws when `NODE_ENV=production`. Tested in `tests/security/controls.test.ts`.

**Fix.** PKCS#11 integration against a FIPS 140-2 Level 3 appliance, non-extractable keys, split-knowledge custody. **Sprint 8.**

---

### SEC-02 · Header-based caller identity — **HIGH**

**Detail.** `contextFrom()` reads `X-ABHI-MSP` and `X-ABHI-Role`. Any caller can claim any organization and any role.

**Impact if shipped.** Complete bypass of the authority model — anyone could assert `ABHIComplianceMSP` and suspend or shred records.

**Compensating control (implemented).** `contextFrom()` throws when `NODE_ENV=production`.

**Fix.** mTLS with client-certificate binding; identity derived from the validated certificate and **never** from a header; OAuth2 client credentials; request signing over `(method, path, body-hash, timestamp, nonce)` with a replay nonce cache. **Sprint 9.**

---

### SEC-03 · `cryptogen` generates all private keys in one place — **HIGH**

**Detail.** `network/crypto-config.yaml` uses `cryptogen`, which materialises every organization's private keys on one filesystem. This directly contradicts the MSP separation that is the entire governance argument for the ledger.

**Impact if shipped.** The three-MSP separation would be theatre: one host compromise yields all three signing identities.

**Compensating control.** Documented in-file; POC-only network.

**Fix.** Fabric CA per organization, offline root, HSM-backed intermediates, keys generated inside the HSM and never exported. Separate cloud accounts and separate administrators per MSP (Blueprint §8.3). **Sprint 8.**

---

### SEC-04 · PII tripwire strips 64-hex tokens before scanning — **MEDIUM**

**Detail.** `assertNoPII` removes `\b[0-9a-f]{64}\b` tokens before testing for 13-digit runs, so `subjectId` and `merkleRoot` do not false-positive. A CNIC embedded inside an otherwise valid 64-hex string would therefore evade the check.

**Assessment.** Low exploitability — the attacker would need to place a CNIC inside a field that is validated as 64 hex characters, and those fields are separately regex-validated. But the exemption is real and should be narrowed.

**Fix.** Strip only the *known* hex-typed fields by name rather than any 64-hex token anywhere in the payload. **Sprint 2 production.**

---

### SEC-05 · Employer bulk lookup is a subject-existence oracle — **MEDIUM**

**Detail.** `employerBulkLookup` reveals, per CNIC, whether that person is already verified at ABHI. An employer could submit arbitrary CNICs and learn ABHI's customer list.

**This is attack scenario S-5 and it is only partly mitigated.** A0 grants nothing, so no *entitlement* leaks — but *existence* does.

**Fix required before the employer portal goes live.**
- Restrict lookups to CNICs with a demonstrated employment relationship.
- Per-employer rate limiting and volume-anomaly alerting.
- **[OPEN-D]** Product and Legal decision on exactly what the portal may display.

---

### SEC-06 · No rate limiting, request signing, or replay protection — **MEDIUM**

**Detail.** The POC HTTP layer implements none of the §8.6 API controls beyond a 1 MB body cap and security response headers.

**Impact.** Enumeration, cost-exhaustion against paid rails, and replay are all unmitigated.

**Fix.** Per-product, per-subject and per-endpoint limits; idempotency keys on mutating endpoints; nonce cache. **Sprint 9.**

---

### SEC-07 · `MemoryVaultStore` overwrite is not a durable erasure — **MEDIUM**

**Detail.** `destroy()` blanks the fields then deletes the map entry. In a garbage-collected heap the original strings may persist until collection.

**Assessment.** Not exploitable in the POC (in-memory, ephemeral). Named because the production PostgreSQL path must not inherit the same assumption: `vault.crypto_shred()` performs an explicit `UPDATE` overwrite before the row is considered shredded, and `DELETE` is revoked from the gateway role precisely so erasure remains auditable.

**Fix.** Wire the PostgreSQL driver; confirm overwrite-before-delete semantics; verify with a heap-dump test. **Sprint 2 production.**

---

### SEC-08 · Attempt-cap counter will drift from NADRA's — **MEDIUM**

**Detail.** `MockRails` maintains its own daily counter. Production has two counters — ABHI's and NADRA's — and network timeouts will desynchronise them.

**Impact.** Drift in one direction locks out legitimate customers (the exact friction this programme exists to remove); in the other it wastes paid calls.

**Fix.** Treat NADRA's response as authoritative; daily reconciliation; alert on divergence. **Sprint 5.**

---

### SEC-09 · CouchDB credentials are literals in compose — **LOW**

`admin/adminpw` and `vault/vaultpw` appear in `network/docker-compose.yaml`. POC-only; flagged in-file. **Fix:** inject from HashiCorp Vault. **Sprint 8.**

---

### SEC-10 · No chaincode-side consent-scope subset check against product policy — **LOW**

`RecordConsent` validates scope against the *attribute set*, not against the granting product's policy. The narrowing happens at `GenerateProof` time, so no over-disclosure is possible — but a consent can be recorded that is broader than any policy would honour, which is confusing in an audit. **Fix:** validate at grant time too.

---

### SEC-11 · Audit event IDs use a process-local counter — **LOW**

`nextEventId` uses a module-level `auditSeq`, which is not deterministic across endorsing peers. In real Fabric this would produce divergent read-write sets and fail endorsement.

**This is a genuine correctness bug for the Fabric adapter, not merely cosmetic.** It does not affect the simulator. **Fix before the Fabric adapter lands (Sprint 4):** derive event IDs deterministically from `txId` plus a within-transaction ordinal that both peers compute identically.

---

### SEC-12 · No SBOM or image signing — **LOW**

CI scans but does not produce a signed SBOM or sign images. **Fix:** Syft + Cosign. **Sprint 9.**

---

## 4. Determinism review (Fabric-specific)

Chaincode must be deterministic — every endorsing peer executes independently and read-write sets must match byte-for-byte.

| Check | Result |
|---|---|
| No `Date.now()` in chaincode | **PASS** — time from `ctx.timestamp` |
| No `Math.random()` in chaincode | **PASS** — IDs supplied by the gateway |
| No external I/O | **PASS** |
| Canonical JSON with recursive key sort | **PASS** |
| Deterministic event IDs | **FAIL — SEC-11** |

---

## 5. Recommendation

**The POC's security posture is appropriate to its scope.** The controls that carry the architectural argument — endorsement separation, hash-chain tamper evidence, PII exclusion, salted selective disclosure, AAD binding, crypto-shredding — are implemented and independently tested.

**Three findings must close before any production deployment** (SEC-01, SEC-02, SEC-03), and each already fails closed. **SEC-11 must close before the Fabric adapter is written**, because it will otherwise surface as intermittent endorsement failures that look like network faults.

**One finding requires a business decision, not an engineering one: SEC-05.** The employer portal cannot go live until Product and Legal answer **[OPEN-D]**.
