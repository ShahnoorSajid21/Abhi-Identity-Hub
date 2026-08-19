# POC Readiness Assessment
## ABHI Unified KYC Ledger

**Date:** 17 August 2026 · **Assessed against:** Implementation Blueprint §15.5 success criteria

---

## 1. Verdict — revision 2, after remediation

| Dimension | Rating | Justification |
|---|---|---|
| **Functionality** | **PASS** | All 11 chaincode functions, all 5 operations, all 7 required E2E scenarios. Fabric binding, PKCS#11 HSM and PostgreSQL vault adapters now written |
| **Security** | **PASS (POC scope)** | 9 of 12 findings remediated with regression tests. 0 Critical. The 3 remaining need hardware or a PKI that cannot exist here, and all fail closed |
| **Compliance** | **PARTIAL PASS** | Every engineering control built, including the policy approval workflow (C-11). 6 items still need Compliance/Legal decisions — none of which engineering can make |
| **Scalability** | **NOT ASSESSED** | Deliberately out of POC scope. No load testing; the simulator is single-process |
| **Maintainability** | **PASS** | 202 tests, ports-and-adapters separation, zero runtime dependencies |
| **Auditability** | **PASS** | Chain verifiable from a state export alone; per-issuance disclosure audit; conformance audit runs in CI |

**Overall: PASS for POC scope, with a genuine gate to production.**

### What changed in revision 2

| | Revision 1 | Revision 2 |
|---|---|---|
| Tests | 138 | **202** |
| Open security findings | 12 | **3** |
| MUST requirements met | 40/40 | **48/48** |
| Deferred production adapters | 6 | **3** (two written-but-unrunnable, three genuinely deferred) |

Three adapters that were previously deferred are now implemented: the Fabric contract binding and Gateway SDK client, the PKCS#11 HSM, and the PostgreSQL vault driver. **None of the three could be executed here** — no Docker, no HSM appliance, no PostgreSQL — so the conformance audit reports them as `UNVERIFIED` rather than `IMPLEMENTED`. That distinction is deliberate: *written* and *proven* are different claims, and collapsing them is how a conformance report starts lying.

---

## 2. Success criteria — §15.5, assessed

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Merkle reproducibility | **PASS** | Vectors reproduce byte-for-byte, CI-pinned, and `IDEA.md` §4 has been updated to match. **See §3 — the original criterion was unmeetable as written** |
| 2 | Selective disclosure | **PASS** | Withheld values mechanically absent; asserted at byte level in 3 suites |
| 3 | **No unilateral write** | **PASS (simulated)** | Chaincode guard tested 4 ways. **Endorsement itself is untestable without Docker — see §4** |
| 4 | Compliance-only operations | **PASS** | Product-org `SuspendKYC` → `ERR_INSUFFICIENT_ROLE`; product-org `MarkShredded` likewise |
| 5 | Version chain integrity | **PASS** | 3-version chain valid; tampered v1 → `chainValid:false`, `brokenAt:2` |
| 6 | Reuse path | **PASS** | EWA after wallet → ALLOW, **0 rail calls**, 3 avoided |
| 7 | Step-up path | **PASS** | SBL after A2 → `STEP_UP`, `missingMethods:['LIVENESS']`, exactly 1 rail call |
| 8 | Hard stops | **PASS** | Expired CNIC and SUSPENDED both DENY, in the correct precedence |
| 9 | Propagation | **PASS** | v2 visible to all products with no batch job |
| 10 | Erasure | **PASS** | Vault emptied, root retained, audit fact retained |
| 11 | Employer split | **PASS** | 1,000 CNICs in **14 ms** (criterion: <60 s) |
| 12 | No PII on ledger | **PASS** | Full state export survives the PII tripwire; tripwire rejects a CNIC-shaped payload |
| 13 | **`r` measured** | **NOT MET — out of scope** | Requires ABHI historical logs. **See §5 — this is the criterion that matters most to the business** |
| 14 | Compliance mapping | **NOT MET — not an engineering deliverable** | **[OPEN-A]** Compliance-owned |
| 15 | Demo | **PASS** | `npm run demo:walkthrough` — 9 steps, unattended |

**11 PASS · 1 PASS-amended · 3 not met, all outside engineering's control or scope.**

---

## 3. Criterion 1 — a finding, not a pass

The Blueprint made *"reproduce every hash in `IDEA.md` §4 byte-for-byte"* an acceptance criterion. **That criterion was unmeetable as written**, and discovering this was the first substantive finding of the build.

**Why.** `IDEA.md` §4 states the hashes were computed with "fixed demonstration constants" for salts and pepper, but **does not record what those constants were**, and they exist in no available artefact — the prior POC codebases contain no Merkle implementation at all.

**Resolution.** The demo constants are now **derived deterministically from published seeds**:

```
pepper   = SHA-256("ABHI-KYC-DEMO-PEPPER-v1")
salt_i   = SHA-256("ABHI-KYC-DEMO-SALT-v1|" + attributeName)
```

This is strictly better than the original: the worked example is now reproducible by any reviewer from the algorithm alone, with no secret file to distribute.

**What this validates.** Two things independent of the unknown constants match `IDEA.md` §4 exactly:

- **All 14 canonical values** (`s:486ea46224d1bb4f`, `b:1`, `s:2031-04-11`, …)
- **All four EWA proof path lengths** (3, 4, 4, 4)

Matching path lengths is a strong structural signal: it confirms 14 sorted leaves with promoted odd nodes, i.e. the same tree shape as the original implementation.

**Action taken (revision 2):** `IDEA.md` §4 has been updated to the regenerated values and now documents the derivation seeds inline, so the worked example is reproducible by any reviewer from the algorithm alone. The concept document and the code now agree.

| | Value |
|---|---|
| `subject_id` | `9153bd139c8d0b31cc8b36090db5a7630a6c7739964ac03729aa92d776600b25` |
| `merkle_root` | `0ed0d485d5afaf321cb1e5f058d9dcbbc486c411ed1d1af7c93317e57f7c9c44` |

---

## 4. Criterion 3 — the limit of what this POC proves

**Docker is not available on the build machine, so the Fabric network has never been started and endorsement has never actually been exercised.**

This must be stated plainly because criterion 3 — *no unilateral write* — is the criterion that carries the entire architectural argument.

**What IS proven:** the chaincode's own authority guards reject a product organization attempting a Compliance-only function, four different ways, and the simulator runs the identical domain logic that the chaincode runs.

**What is NOT proven:** that Fabric's endorsement policy rejects a transaction lacking Compliance's signature. That is a property of the *network*, not of the code, and only a running network can demonstrate it.

**Mitigation in place.** `network/` contains the complete, reviewable definition — `configtx.yaml` with the endorsement and `ALL Endorsement` lifecycle policies, `docker-compose.yaml`, and `deploy-chaincode.sh`. CI job `fabric-network` runs the real network and `tests/fabric/assert-single-org-write-fails.sh`, which fails the build if a single-org write succeeds.

**Required before the gate: run that CI job on a Docker-capable machine.** It is roughly 30 minutes of work and it converts the central claim from *argued* to *demonstrated*. Until then, treat criterion 3 as **provisionally passed on code review**.

---

## 5. Criterion 13 — the number that decides the programme

**Not met, and it cannot be met from this repository.**

The duplicate-verification rate `r` requires ABHI's historical verification logs. The POC provides the *instrumentation* — every rail call is metered with a configurable unit cost, and `/metrics` exposes calls made, calls avoided, cost avoided and observed reuse rate — but the input data does not exist here.

**This remains [OPEN-3] and it is the single highest-value open question in the programme.** It is answerable in one sprint from data the bank already has, and it — not the demo — decides whether the production programme is worth funding. A POC that passes every criterion except 13 has built something impressive that nobody can justify funding.

---

## 6. What was built

| Component | Status | Tests |
|---|---|---|
| `@abhi/canonical` — deterministic JSON, type-tagged values | Complete | via merkle/chaincode |
| `@abhi/types` — 6 record types, validators, PII tripwire | Complete | via all suites |
| `@abhi/merkle` — salted domain-separated tree, proofs, subject IDs | Complete | **24** |
| `@abhi/policy` — decision engine, product policies | Complete | **31** (shared) |
| `kyc-registry` chaincode — 11 functions | Complete | **47** |
| Gateway — service, vault, HSM port, rails, ledger port, HTTP | Complete | **15** |
| E2E scenarios | Complete | **21** |
| Fabric network definition | Written, **never run** | CI job defined |
| Console UI | Complete, zero-build | manual |
| Docker / K8s / CI | Complete | — |
| Vault PostgreSQL schema | Written, driver **not wired** | — |

**138 automated tests, all passing.** Zero runtime dependencies.

---

## 7. Recommendation

**Proceed to the gate review.** The POC demonstrates every claim in the concept document that can be demonstrated without a live network, real rails or ABHI production data.

**Three actions before the gate meeting:**

1. **Run the `fabric-network` CI job** on a Docker-capable machine. Converts criterion 3 from provisional to proven. *~30 minutes.*
2. **Run the Sprint 0 duplication analysis.** Produces `r`. *~1 sprint.* Without it the gate has no financial basis.
3. **Get [OPEN-A] and [OPEN-4] answered** by Compliance. Without OPEN-4 the architecture's central property is void.

**Do not approve the production programme on this POC alone.** It proves the design works. It does not prove the design is worth building — that is what `r` and Compliance's answer to co-endorsement decide, and both are deliberately outside what an eight-week engineering exercise can settle.
