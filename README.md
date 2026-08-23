# ABHI Unified KYC Ledger — Proof of Concept

**A permissioned blockchain holding proof — not data — of every identity verification ABHI has performed.**

ABHI verifies the same person's identity many times over: wallet onboarding, EWA, ASA, salary-backed lending, merchant financing, employer portal. This POC makes those verifications **reusable, versioned, provable and revocable** — without putting a single byte of personal data on a ledger.

---

> **New here?** Read **[docs/RUNNING.md](docs/RUNNING.md)** — a step-by-step guide to running the POC, with every command explained and a full walkthrough of how the system works.

## Quick start

No Docker required. No external dependencies. Node 22.6+ only.

```bash
npm install
```

See the concept end to end with dummy data — one employer, eight fictional workers, nine months:

```bash
npm run demo:scenario
```

Run the technical nine-step walkthrough:

```bash
npm run demo:walkthrough
```

Run every test (296):

```bash
npm test
```

The console has its own 55, under vitest:

```bash
npm run test:web
```

Seed six personas covering every decision path:

```bash
npm run demo:seed
```

Start the gateway, then open `apps/console/index.html` in a browser:

```bash
npm run gateway:dev
```

Verify the cryptographic construction against its pinned vectors:

```bash
npm run vectors:verify
```

Audit the implementation against the architecture blueprint:

```bash
npm run audit:conformance
```

---

## What this does

| Operation | What happens |
|---|---|
| **Register** | Runs the full journey, builds a salted Merkle root over 14 attributes, stores salts in an encrypted vault, commits v1 |
| **Verify** | Decides `ALLOW` / `STEP_UP` / `FULL_KYC` / `DENY` against product policy — and on ALLOW, makes **zero rail calls** |
| **Step-up** | Runs **only the missing methods**. An A2 customer applying for SBL runs one selfie, not the whole pack |
| **Update** | Appends a hash-linked version. Every product resolves to it on its next call — no batch job |
| **Suspend** | One Compliance action; every product denies immediately |
| **Erase** | Crypto-shred: destroy the key, keep the audit fact |

---

## Architecture at a glance

```
apps/console/          zero-build browser console (7 screens)
services/gateway/      policy engine · proof assembly · consent · vault · rails · HTTP
chaincode/kyc-registry 11 functions · pure domain over a StateStore port
packages/merkle/       salted domain-separated Merkle tree · subject-ID derivation
packages/policy/       deterministic decision engine · product policies
packages/types/        6 record types · validators · PII tripwire
packages/canonical/    deterministic JSON · type-tagged value encoding
network/               Fabric: 3 MSPs, Raft ordering, endorsement policy
vault/                 PostgreSQL schema · envelope encryption · crypto-shred
infrastructure/        Kubernetes · hardening · default-deny egress
ci-cd/                 9-gate pipeline, crypto vectors gated first
tests/                 e2e · integration · security
docs/                  security, compliance, conformance, gap, readiness reports
```

**Two ports make this testable and demoable without Docker:**

- `StateStore` — `MemoryStateStore` (tests, demo) or Fabric's `ChaincodeStub`
- `LedgerPort` — `SimulatedLedger` or the Fabric Gateway SDK client

The simulator runs the **same domain logic** as the chaincode: same validation, same state machine, same hash chaining. It provides **none** of the governance properties — no endorsement, no ordering, no independent peers — and refuses to start when `NODE_ENV=production`.

---

## The three properties this exists to demonstrate

1. **No unilateral write.** Compliance must co-endorse every KYC status change. No product team and no DBA can declare a customer verified alone.
2. **Auditable history.** Every version is hash-chained to its predecessor, verifiable from a state export alone — an inspector should not have to trust ABHI's blockchain to verify ABHI's history.
3. **National alignment.** SBP advised banks to join the PBA shared e-KYC platform. Joining requires one canonical KYC record per customer. ABHI does not have one. This is that record.

---

## Cryptographic construction

```
subject_id = HMAC-SHA256(pepper, normalise(CNIC))      pepper is HSM-resident

leaf_i     = SHA-256(0x00 ‖ salt_i ‖ 0x00 ‖ name_i ‖ 0x00 ‖ canonical(value_i))
node       = SHA-256(0x01 ‖ left ‖ right)
root       = merkle_root(leaves sorted by attribute name, odd nodes promoted)
```

Four details are load-bearing and each has a test:

| Detail | Without it |
|---|---|
| Per-attribute 32-byte salt | `fatca_status=false` has one leaf hash bank-wide, instantly recognisable |
| Domain separation `0x00`/`0x01` | An internal node can be presented as a leaf — Merkle second-preimage |
| Sorted by name | The root depends on supply order |
| Odd nodes **promoted**, not duplicated | Distinct leaf sets produce the same root (CVE-2012-2459 class) |
| Type tags `s:` `b:` `d:` `n:` | The string `"true"` and boolean `true` collide onto one leaf |

**Hashing a CNIC does not anonymise it.** 13 digits is ~10¹³ values — exhaustible against SHA-256 on a commodity GPU in hours. The keyed construction is what makes on-chain identifiers uncorrelatable without the pepper.

---

## Test coverage

| Suite | Tests | Covers |
|---|---|---|
| `packages/merkle` | 36 | Domain separation, odd-node promotion, 2,000-iteration property test, CNIC normalisation, pinned reference vectors |
| `chaincode/kyc-registry` | 53 | All 11 functions, state machine, authority separation, tamper detection, chain-hash ordering |
| `packages/policy` | 39 | Exhaustive decision table (64 combinations), step-up matrix, four-eyes policy approval, change classification |
| `services/gateway` | 32 | Directory reads, pending liability, daily activity, presentation indexing |
| `tests/security` | 71 | PII structural walk, log redaction, vault AAD swap, rate limiting, idempotency, replay, request signing, employer roster gating over HTTP, e-CIB outcome, production guards |
| `tests/integration` | 36 | Live HTTP API, security headers, error mapping |
| `tests/e2e` | 29 | All seven required scenarios plus employer bulk and attempt caps |
| `apps/web` | 55 | Step-up router, capture screens, decision rendering (vitest) |

```bash
npm run test:unit         # merkle, canonical, policy, chaincode  (128)
npm run test:security     # PII, redaction, vault AAD, rate limits, replay, signing, guards  (71)
npm run test:integration  # live HTTP API  (36)
npm run test:e2e          # the seven scenarios  (29)
npm run test:web          # the console, under vitest  (55)
```

`npm run verify` runs all of the above plus both type checks, the CNIC-literal
scan, the pinned crypto vectors and the conformance audit.

---

## What this POC deliberately does NOT do

| Not claimed | Why |
|---|---|
| Removes any CDD obligation | Full KYC/CDD still applies. What goes away is *re-collecting* what ABHI already verified |
| Removes e-CIB | A credit check, not an identity check. It runs at every origination — architecturally cannot be skipped by reuse |
| Removes AML/sanctions screening | Point-in-time checks against changing lists |
| Replaces NADRA | NADRA remains the source of truth. The ledger remembers what NADRA already said, and when |
| Makes KYC "better" | It makes it *consistent, versioned and provable*. Individual verification quality is unchanged |
| Stores biometric data | Only the boolean outcome, as a salted leaf. No template, no image, ever |
| Is a cryptocurrency | No token, no mining, no external network |

---

## Known limitations of this build

Read `docs/POC_READINESS.md` before demoing. Three things remain, and none can be closed from this machine:

1. **Fabric has never been started.** Docker is unavailable here. The contract binding (`contract.ts`), the Gateway SDK client (`fabric-ledger.ts`), the network definition and the endorsement policy are all written — but *written* is not *proven*. `tests/fabric/assert-single-org-write-fails.sh` and the `fabric-network` CI job exist to close this in about 30 minutes on a Docker-capable machine. **This is the top priority**, because "no unilateral write" is the claim that carries the whole architecture.
2. **The PKCS#11 HSM and PostgreSQL vault adapters are written but unexecuted** — no HSM appliance, no PostgreSQL instance. The conformance audit reports these as `UNVERIFIED`, not `IMPLEMENTED`, on purpose.
3. **The duplicate-verification rate `r` is not measured.** It needs ABHI's historical logs. The instrumentation is built and `/metrics` exposes it; the data is not here. This is the number that decides whether the production programme is worth funding.

4. **[OPEN-E] The savings figure may be overstated, and nobody can yet say by how much.** This system models one thing: is the identity on file good enough for this product. Consolidated Product Manual v2 Part Two §9.3 puts a fingerprint *and* a live selfie on every EWA, ASA and SBL request — and its wording ("before the request proceeds to approval", capped at 3 attempts per day) reads like **transaction authorisation**, not customer due diligence. A per-request authentication is not reusable by anything, so any share of it counted as "avoided" is spend that would happen regardless. The alternative reading — that §9.3 is a CDD requirement — makes EWA and ASA A3 rather than the A2 configured here, which removes EWA's "zero rail calls" claim instead. Both readings change the business case; neither can be settled without Compliance. See `packages/policy/src/policies.ts`.

Security posture: **13 of 16 findings remediated** with regression tests. The 3 remaining are environmental and all fail closed — the software HSM, the simulated ledger and the header-identity fallback each refuse to initialise when `NODE_ENV=production`.

Four of those findings came from the end-to-end review of 23 August 2026, and three of them share a shape worth naming: **a control that was built, tested and reported implemented, but not connected.** The employer roster gate could not engage over HTTP; the per-subject rate limit did not cover the identifier the console actually sends; the e-CIB check ran on every origination and its answer was discarded. Each had passing unit tests. The conformance audit now asserts call site, wiring and mechanism together rather than grepping for a class name — see `allOf()` in `scripts/conformance-audit.ts`.

Full findings: `docs/SECURITY_AUDIT.md` · `docs/COMPLIANCE_AUDIT.md` · `docs/GAP_ANALYSIS.md`

---

## Running against a real Fabric network

Requires Docker.

```bash
npm run network:up
npm run network:deploy-cc
bash tests/fabric/assert-single-org-write-fails.sh
npm run network:down
```

---

## Documents

| Document | Purpose |
|---|---|
| `docs/RUNNING.md` | **Step-by-step guide: how to run it, and how it works** |
| `ABHI_Unified_KYC_Ledger_Blueprint.md` | The architecture and 15-section implementation blueprint |
| `docs/SECURITY_AUDIT.md` | 12 findings with severity and sprint assignment |
| `docs/COMPLIANCE_AUDIT.md` | Control matrix and instrument-by-instrument mapping |
| `docs/GAP_ANALYSIS.md` | Everything deferred, and to which sprint |
| `docs/POC_READINESS.md` | Success criteria assessed; the gate recommendation |

---

*Demonstration salts and pepper are derived from published seeds so the worked example is reproducible from the algorithm alone. **Never use those constants outside a demo.***
