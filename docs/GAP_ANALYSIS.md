# Gap Analysis
## ABHI Unified KYC Ledger — implementation vs. blueprint

**Date:** 17 August 2026 · **Generated against:** `npm run audit:conformance` (44 implemented, 0 partial, 0 missing, 6 deferred)

---

## 1. Conformance summary

| Priority | Total | Implemented | Partial | Missing | Deferred |
|---|---|---|---|---|---|
| **MUST** | 40 | **40** | 0 | 0 | 0 |
| **SHOULD** | 4 | 4 | 0 | 0 | 0 |
| **POC-DEFERRED** | 6 | — | — | — | 6 |

**Every MUST requirement is implemented and asserted by an executable check.** The conformance audit runs in CI and fails the build if any regresses — a hand-maintained conformance table drifts from the code within a sprint; this one cannot.

---

## 2. Deferred items — what is not built, why, and when

### GAP-01 · PKCS#11 hardware HSM — **Sprint 8**

**Not built.** `SoftwareHsm` derives pepper and KEK from published seeds and holds them in process memory.

**Why deferred.** HSM procurement has a lead time measured in weeks and is a capital decision. Building against a port and swapping the implementation is the correct sequencing.

**What exists.** The `Hsm` port (`hmacPepper`, `generateDek`, `wrapDek`, `unwrapDek`) is exactly the PKCS#11 surface. The production implementation is one file.

**Fails closed.** Constructor throws on `NODE_ENV=production`. Tested.

**Effort.** ~1 sprint including a witnessed key ceremony and a rehearsed rotation.

---

### GAP-02 · Fabric Gateway SDK adapter — **Sprint 4**

**Not built.** `SimulatedLedger` runs the chaincode domain logic against an in-memory store.

**Why deferred.** Docker was unavailable on the build machine. More substantively: the domain logic and the network client are genuinely separable, and building the domain first meant 47 chaincode tests could exist before any network did.

**What exists.** The `LedgerPort` interface; the complete network definition in `network/`; the chaincode itself, unchanged, ready to load.

**Critical caveat.** The simulator provides **no endorsement, no ordering and no independent peers**. It therefore proves nothing about the governance properties. See `docs/POC_READINESS.md` §4.

**Blocked by.** SEC-11 — the audit event ID counter is non-deterministic and will break endorsement. **Fix that first.**

**Effort.** ~1 sprint.

---

### GAP-03 · mTLS, OAuth2, request signing, replay protection — **Sprint 9**

**Not built.** Header-based identity (`X-ABHI-MSP`, `X-ABHI-Role`).

**Why deferred.** Requires ABHI PKI, Keycloak and an API gateway — none available in a standalone POC.

**Fails closed.** `contextFrom()` throws on `NODE_ENV=production`.

**Effort.** ~1 sprint, mostly integration with existing ABHI infrastructure.

---

### GAP-04 · Real NADRA / e-CIB / CBS / Mobiliser — **Sprints 4–6**

**Not built.** `MockRails` and `MockECib`, cost-instrumented.

**Why deferred.** Blueprint assumption A-3 — no production credentials are requested or used. This is what keeps the POC out of change control.

**The long pole is commercial, not technical.** NADRA contracting is outside engineering's control and **must start at S0, not S4**.

**Two integration risks already identified:** biometric attempt-counter drift (SEC-08) and CBS freeze ↔ ledger suspension reconciliation.

**Effort.** ~3 sprints engineering; contracting unknown.

---

### GAP-05 · Migration and backfill — **Sprints 13–14**

**Not built.** No backfill engine.

**Why deferred.** Blocked on **[OPEN-5]** — what assurance level is assigned to existing customers whose original evidence is incomplete. That is a Compliance decision with material commercial consequence: assign too high and the bank grants reliance it cannot evidence; assign too low and the platform launches with a base that all needs re-verification, destroying the value proposition on day one.

**This is the largest single workstream in the programme and the one most likely to be underestimated.** It should run from S6 in parallel, not at the end.

**Effort.** ~85 person-days engineering plus substantial Compliance and Operations effort not sized here.

---

### GAP-06 · PostgreSQL vault driver — **Sprint 2 (production track)**

**Not built.** `MemoryVaultStore`. The **schema is written** (`vault/schema.sql`) including `crypto_shred()`, least-privilege grants and a decrypt-audit table.

**Why deferred.** Zero-dependency constraint; the `VaultStore` port is three methods.

**Effort.** ~3 days plus SEC-07 verification.

---

## 3. Gaps introduced BY the implementation

Findings discovered during the build that the blueprint did not anticipate.

| ID | Gap | Severity | Action |
|---|---|---|---|
| **NEW-01** | **`IDEA.md` §4 reference hashes are unreproducible** — original demo salts and pepper recorded nowhere; prior POCs contain no Merkle implementation | **High (documentation)** | Update `IDEA.md` §4 to the regenerated vectors, or supply the original constants. Canonical values and path lengths already match exactly |
| **NEW-02** | **Blueprint success criterion 1 was unmeetable as written** | Process | Criterion amended in `POC_READINESS.md` §3. Demo constants now derived from published seeds — strictly better, since the example is reproducible from the algorithm alone |
| **NEW-03** | **Non-deterministic audit event IDs (SEC-11)** would break Fabric endorsement | **High** | Fix before GAP-02. Derive from `txId` + within-transaction ordinal |
| **NEW-04** | **Employer bulk lookup is a subject-existence oracle (SEC-05)** | Medium | **[OPEN-D]** Product + Legal decision before the employer portal ships |
| **NEW-05** | **Consent scope not validated against product policy at grant time (SEC-10)** | Low | Narrowing happens at proof time so no over-disclosure is possible; confusing in audit |
| **NEW-06** | **`assertNoPII` exempts any 64-hex token (SEC-04)** | Medium | Narrow to named hex-typed fields |
| **NEW-07** | **Blueprint recommended Fastify; implementation uses `node:http`** | Low — accepted deviation | Zero dependencies means the gateway runs anywhere. OpenAPI 3.1 is the contract either way. Revisit if middleware needs grow |

---

## 4. Requirements the blueprint specified that were NOT deferred

Worth stating explicitly, because these are the ones that could plausibly have been skipped and were not:

| Requirement | Why it mattered enough to build now |
|---|---|
| Post-supersession chain hashing | Getting this wrong makes the chain unverifiable from a state export — the entire audit property. Has a dedicated test |
| Merkle odd-node promotion | Duplicating admits distinct leaf sets with identical roots |
| Domain-separated prefixes | Second-preimage substitution |
| Vault AAD binding | A swap attack leaves the ledger untouched and looks legitimate |
| PII tripwire | One leaked CNIC on an immutable ledger is a permanent incident |
| Assurance/methods consistency | Closes assurance inflation at write time |
| Production guards on every POC component | Stops the POC becoming a deployment by accident |
| Property-based Merkle testing | The claim most likely to be probed, least likely to break from an obvious bug |
| Executable conformance audit | A prose conformance table drifts within a sprint |

---

## 5. Recommended order of work after the gate

1. **SEC-11** — deterministic event IDs. *Blocks GAP-02.* ~1 day.
2. **GAP-02** — Fabric adapter, then run `assert-single-org-write-fails.sh`. **Converts the central claim from argued to demonstrated.**
3. **GAP-06** — PostgreSQL vault driver. Small, unblocks realistic load testing.
4. **GAP-01** — HSM. Long lead time; start procurement immediately.
5. **GAP-03** — mTLS and API hardening.
6. **GAP-04** — real rails. **Start contracting now, in parallel with everything above.**
7. **GAP-05** — migration. Needs **[OPEN-5]** answered first.

**Items 1 and 2 together are roughly one sprint and they close the most important evidential gap in the entire POC.** Everything else can follow.
