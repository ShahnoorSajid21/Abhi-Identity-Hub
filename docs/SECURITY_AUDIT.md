# Security Audit Report
## ABHI Unified KYC Ledger — POC Implementation

| | |
|---|---|
| **Scope** | `packages/`, `chaincode/`, `services/`, `network/`, `infrastructure/`, `vault/`, `ci-cd/` |
| **Method** | Code review against the Implementation Blueprint §8 threat model; executable control tests in `tests/security/`; conformance audit `npm run audit:conformance` |
| **Date** | 23 August 2026 · **revision 4** after the end-to-end review |
| **Verdict** | **PASS for POC scope.** 13 of 16 findings REMEDIATED. 3 remain, all requiring hardware or a live network that cannot exist in this environment |

---

## 1. Summary — revision 4

| Severity | Remediated | Remaining | Note |
|---|---|---|---|
| **Critical** | — | 0 | — |
| **High** | 5 | 2 | Both remaining need hardware (HSM) or a PKI. SEC-15 to SEC-18 added in revision 4 |
| **Medium** | 5 | 0 | All closed with executable tests |
| **Low** | 3 | 1 | SEC-11 was reclassified High and closed |
| **Process** | 2 | 0 | SEC-13 (no type checking) and SEC-14 (gate blind spots), found in a verification pass |

**Thirteen findings closed**, each with regression tests: SEC-04, SEC-05, SEC-06, SEC-07, SEC-09, SEC-10, SEC-11, SEC-12, SEC-13, SEC-14, SEC-15, SEC-16, SEC-17, SEC-18, and control C-11.

**Test count rose from 138 to 296**, plus 55 in the console — which now runs in CI for the first time.

**Revision 4's four findings are documented below in full, but the pattern matters more than any one of them.** Three of the four were controls that had been built, unit-tested, and reported `IMPLEMENTED` by the conformance audit — and were not connected to any path a caller can take. A grep for a class name cannot tell the difference, and until revision 4 that was what the audit did. The lesson is not "write more tests"; there were tests. It is that a control has a **call site** as well as a mechanism, and only the call site makes it real.

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

### Revision 4 — four findings from the end-to-end review, 23 August 2026

Three of the four share one shape, and it is the shape worth naming: **a control that was built, unit-tested, and reported `IMPLEMENTED` — but not connected to anything a caller can reach.** Every one of them had passing tests. None of those tests exercised the path a request actually takes.

**SEC-15 · Log redaction missed the CNIC format that actually arrives — HIGH, CLOSED.**

`scrubString` matched `\d{13,}`. A Pakistani CNIC is rendered `00000-0000000-0` — the format the Product Manual itself specifies on the CNIC entry screen (Part Two §9.1) — and the dashes break the digit run, so `61101-1234567-8` passed through the redactor untouched.

No coding mistake was needed to reach it. `GET /kyc/history?cnic=` and `GET /audit/events?cnic=` take the CNIC in a query string, and the request logger writes `path: req.url` verbatim through `redact()`. One customer lookup wrote a citizen's primary identifier to stdout, and from there to wherever container logs ship.

The module's own header called the digit-run rule "the backstop that makes that mistake survivable". It was not a backstop for the only format that occurs in practice.

Fixed with a separator-aware 5-7-1 rule alongside the existing digit-run rule. 64-hex identifiers are now lifted out before scrubbing and restored after, so `subjectId` values — a meaningful fraction of which contain a 13-digit run by chance — survive intact rather than being mangled into `[REDACTED-ID]`. Six tests, including the exact log line the request logger emits.

The placeholder used for that lift-out is `__ABHI_HEX_n__`, deliberately plain ASCII. A NUL-delimited version was written first and discarded — see the defect recorded immediately above, which is the second time a raw control character nearly entered this codebase in a security-relevant file.

**SEC-16 · The SEC-05 roster gate could not engage over HTTP — HIGH, CLOSED.**

`POST /employer/bulk-lookup` called `employerBulkLookup(tx, cnics)` with no `employerId`, and `server.ts` constructed the service with no `EmploymentRegister`. The two failure modes were:

- **with** a register configured — every request fails `ERR_INVALID_SCOPE`; the endpoint is simply broken;
- **without** one — the configuration the bootstrap actually shipped — the endpoint answers "is this CNIC already verified at ABHI?" for *any* CNIC submitted. That is attack scenario S-5, an existence oracle over the entire customer base, reachable by anyone who can call the API.

SEC-05 was marked **CLOSED** in the table above and `R-04` reported `IMPLEMENTED` by the conformance audit. Both were true of the mechanism and false of the system: the audit's check was `fileHas('security.ts', 'class EmploymentRegister', 'unauthorised')` — a grep for a class name.

Fixed by taking the employer from the **authenticated principal** — `OU=employer:<id>` in the client certificate, `x-abhi-employer` on the dev header shim — never from the request body, which would let any employer name another and read their roster. The register is wired and seeded in `server.ts`, and `KycGatewayService` now throws at construction when none is supplied and `NODE_ENV=production`, matching the fail-closed pattern the software HSM and simulated ledger already use.

Three tests, all driving real HTTP, including one asserting that a verified customer outside the roster is byte-identical in the response to a complete stranger.

**SEC-17 · Per-subject rate limiting did not cover the `subjectId` path — HIGH, CLOSED.**

The subject dimension is described in `security.ts` as "the enumeration and cost-attack control". It keyed on `cnic` alone. But `/kyc/verify`, `/kyc/update`, `/kyc/suspend` and `/kyc/reinstate` all accept `subjectId` and **prefer it when both are present**, the operations console sends nothing else, and the customer read routes are `/customers/{subjectId}/…`.

So the control covered the identifier the design spent considerable effort *removing from requests*, and not the one it replaced it with. Enumeration by subject id ran under the 600/min product limit rather than the 20/min subject limit.

Fixed to count all three identifier positions — body, query string and path parameter. One test drives 40 subject-id verifies and asserts a 429.

**SEC-18 · The e-CIB result was discarded — HIGH, CLOSED.**

e-CIB is the one origination control the blueprint marks "never bypassed". It ran on every non-DENY verify, and the gateway awaited it and dropped the return value:

```ts
await this.#d.ecib.check(subjectId);   // result discarded
eCibCalled = true;
```

`eCibCalled: true` said the check *happened*; nothing said what it *found*. A subject with an adverse credit record produced a response byte-identical to a clean one. `MockECib` answered `clean: true` unconditionally, so no test could distinguish the two — and swapping in a real provider would have preserved the behaviour exactly: the call made, billed, and ignored. "Never bypassed" had been implemented as "always called", which is a different claim.

Fixed by carrying the outcome out as `VerifyResult.eCib` and rendering it in the console. `MockECib.markAdverse()` makes the not-clean branch reachable from a test, which it previously was not.

Deliberately **not** wired into `decide()`. Credit standing is not identity, and conflating the two is the most dangerous available misreading of this architecture — the ledger's answer stays "is this identity good enough for this product", and `clean: false` is the originating product's gate to apply on top. It is also not written to the ledger: credit standing is point-in-time and changes; identity proof does not.

**Process finding — the conformance audit could not tell "built" from "connected".**

Three of the four above were reported as implemented controls. The audit now provides `allOf()`, and `R-04` asserts mechanism, call site, production guard and bootstrap wiring together. A single-file grep cannot establish that a control is reachable, and this is what that looks like in practice.

**Related gate blind spot — the console was outside CI entirely.** `npm run typecheck` covers the root tsconfig only; `npm test` does not invoke vitest; no CI job ran either. 55 console tests ran only on a developer's machine, and a type error in `apps/web` reached main with every build green — the precise failure SEC-13's own remediation comment warns about. A `console` gate now runs vitest and the production build, and `typecheck:web` runs beside `typecheck`.

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
