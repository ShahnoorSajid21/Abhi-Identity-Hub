# Running the ABHI Unified KYC Ledger POC
### A step-by-step guide, and an explanation of how the whole thing works

**Audience:** anyone who needs to run, demo, review or extend this POC. No prior Hyperledger Fabric knowledge assumed.

---

## Contents

- [Part 1 — Run it in five minutes](#part-1--run-it-in-five-minutes)
- [Part 2 — Every command, explained](#part-2--every-command-explained)
- [Part 3 — How the system actually works](#part-3--how-the-system-actually-works)
- [Part 4 — Tracing one request end to end](#part-4--tracing-one-request-end-to-end)
- [Part 5 — The API](#part-5--the-api)
- [Part 6 — The console UI](#part-6--the-console-ui)
- [Part 7 — Running against a real Fabric network](#part-7--running-against-a-real-fabric-network)
- [Part 8 — Troubleshooting](#part-8--troubleshooting)
- [Part 9 — What this POC does not do](#part-9--what-this-poc-does-not-do)

---

# Part 1 — Run it in five minutes

## Step 1.1 · Check your Node version

```bash
node --version
```

You need **Node 22.6 or newer**. The POC runs TypeScript directly using Node's built-in `--experimental-strip-types` flag, so there is no build step and no transpiler to install.

If you are below 22.6, install Node 22 LTS from nodejs.org. Nothing else on your machine is affected.

> **Windows:** everything below works in PowerShell, Git Bash or WSL2. Only Part 7 (real Fabric) requires WSL2.

## Step 1.2 · Install

```bash
npm install
```

Takes seconds. The POC has **zero runtime dependencies** — the only packages installed are TypeScript and type definitions used to check the production adapters. Nothing is fetched at runtime; the gateway runs on a machine with no network access.

## Step 1.3 · Prove the cryptography is intact

```bash
npm run vectors:verify
```

Expected: `# pass 7`, `# fail 0`.

**Run this first, always.** It checks the Merkle construction against pinned reference vectors. If the hashing, sorting, padding or domain separation has drifted, every result downstream is meaningless — which is why this gate also runs before everything else in CI.

## Step 1.4 · Verify everything

```bash
npm run verify
```

Runs, in order: type check → CNIC literal gate → reference vectors → 203 tests → conformance audit.

Expected ending:

```
ℹ tests 203
ℹ pass 203
ℹ fail 0
MUST requirements: 48/48 implemented
```

If this passes, the POC is healthy.

## Step 1.5 · See the concept

```bash
npm run demo:scenario
```

**This is the one to show people.** Eight fictional workers at a textile mill, nine months of activity, told as a story with a cost tally. Explained fully in [Part 2.6](#26--npm-run-demoscenario--the-concept-with-dummy-data).

## Step 1.6 · Start the gateway and open the console

```bash
npm run gateway:dev
```

Leave it running. Then open `apps/console/index.html` in a browser — just double-click the file, no web server needed.

You now have a working KYC ledger with a seven-screen UI.

---

# Part 2 — Every command, explained

| Command | What it does | Time |
|---|---|---|
| `npm run verify` | Everything: types, gates, vectors, tests, conformance | ~30s |
| `npm run typecheck` | TypeScript type checking only | ~10s |
| `npm test` | All 203 tests | ~7s |
| `npm run test:unit` | Crypto, canonical, policy, chaincode | ~3s |
| `npm run test:security` | Security controls only | ~2s |
| `npm run test:integration` | Live HTTP API | ~1s |
| `npm run test:e2e` | The seven required scenarios | ~1s |
| `npm run vectors:verify` | Pinned crypto vectors | ~1s |
| `npm run vectors:generate` | Regenerate vectors, print the worked example | ~1s |
| `npm run check:cnic` | Reject undeclared CNIC literals | ~1s |
| `npm run audit:conformance` | Blueprint requirements vs implementation | ~1s |
| `npm run demo:scenario` | The story, with dummy data | ~2s |
| `npm run demo:walkthrough` | Technical nine-step demonstration | ~2s |
| `npm run demo:seed` | Seed six personas | ~2s |
| `npm run gateway:dev` | Start the HTTP gateway on :8080 | — |
| `npm run network:up` | Start real Fabric (**needs Docker**) | ~2min |

---

## 2.1 · `npm run typecheck`

Runs `tsc --noEmit`. Expected: no output at all.

**Why this matters more than it looks.** `node --experimental-strip-types` *runs* TypeScript by deleting the type annotations — it does **not** check them. For most of this project's life, 203 tests passed green while 12 genuine type errors sat in the tree. A passing test suite tells you nothing about type safety.

That is why `typecheck` is a CI gate running *before* the unit tests, and the first thing `npm run verify` does.

## 2.2 · `npm test`

203 tests across 52 suites:

| Suite | Tests | What it protects |
|---|---|---|
| `packages/merkle` | 24 | Domain separation, odd-node promotion, a 2,000-iteration property test, CNIC normalisation, pinned vectors |
| `chaincode/kyc-registry` | 47 | All 11 chaincode functions, the state machine, authority separation, tamper detection, chain-hash ordering |
| `packages/policy` | 47 | The full decision table (64 combinations), the step-up matrix, four-eyes policy approval |
| `tests/security` | 75 | PII walk, vault swap attack, rate limits, replay, signing, employer gating, production guards |
| `tests/integration` | 15 | The real HTTP API, security headers, error mapping |
| `tests/e2e` | 21 | The seven required scenarios plus employer bulk and attempt caps |

Run a slice while developing:

```bash
npm run test:security
```

## 2.3 · `npm run vectors:generate`

Prints the complete worked example — subject ID, Merkle root, all 14 leaves with canonical forms, the four disclosed attributes with proof path lengths, and the chain-link hash — then writes `packages/merkle/vectors/reference-vectors.json`.

**The demonstration constants are derived, not stored:**

```
pepper  = SHA-256("ABHI-KYC-DEMO-PEPPER-v1")
salt_i  = SHA-256("ABHI-KYC-DEMO-SALT-v1|" + attributeName)
```

Any reviewer can reproduce every hash from the algorithm alone, with no secret file to pass around. Production salts are 32 random bytes per attribute per record, generated inside an HSM.

**If this file ever changes, stop.** A change to the hashing construction alters every historical root in the bank. CI fails the build when regenerated vectors differ from the committed ones, and the correct fix is a new `attributeSetId` — not an updated test.

## 2.4 · `npm run check:cnic`

Scans `packages`, `services`, `chaincode`, `scripts`, `apps` and `tests` for 13-digit runs — the shape of a Pakistani CNIC.

Fictional CNICs are legitimately needed (you cannot test a PII tripwire without one), so any file holding them must declare it:

```ts
// FICTIONAL-CNIC-OK: fictional CNICs; the PII tripwire cannot be tested without them
```

Marker-based rather than a path allow-list, deliberately: an allow-list goes stale silently, which is exactly how an earlier version of this gate ended up not scanning `scripts/` or `apps/` at all.

Expected: `OK — 11 file(s) declare fictional CNICs; no undeclared literals.`

## 2.5 · `npm run audit:conformance`

Checks every requirement from the Implementation Blueprint against the actual repository — file existence, exported symbols, specific code constructs.

Expected: `MUST requirements: 48/48 implemented`.

Five statuses, and the distinction between two of them matters:

| Status | Meaning |
|---|---|
| `IMPLEMENTED` | Built and exercised here |
| `UNVERIFIED` | **Code exists and type-checks, but could not be executed in this environment** — no Docker, no HSM, no PostgreSQL |
| `PARTIAL` | Partially present |
| `MISSING` | Not built |
| `DEFERRED` | Deliberately out of POC scope, mapped to a sprint |

`UNVERIFIED` exists because *written* and *proven* are different claims. Collapsing them is how a conformance report starts lying.

## 2.6 · `npm run demo:scenario` — the concept, with dummy data

**Show this one to management.** Eight fictional workers at *Sitara Textile Mills, Faisalabad*, over nine months. Every name, CNIC and account is invented.

| Act | What happens | What it demonstrates |
|---|---|---|
| 1 | Employer uploads 8 CNICs via CSV | All land at **A0** — asserted, verified by nothing. Today ABHI stores these identically to a biometrically-verified CNIC |
| 2 | Four open ABHI wallets | A0 → A2 via the real Asaan journey, PKR 80 each |
| 3 | Employer asks "who can I activate?" | 4 activate now / 4 need onboarding. **ABHI cannot produce this screen today** |
| 4 | Verified workers request EWA | **ALLOW, zero rail calls.** e-CIB still runs. A proof of 4 of 14 attributes, withheld values checked absent in bytes |
| 5 | Ayesha needs SBL (A3) | **STEP_UP naming `LIVENESS` only** — PKR 20 instead of PKR 100 |
| 6 | Ghulam's CNIC has lapsed | Hard **DENY** across all products, never STEP_UP. He renews → v3 → every product sees it, no batch job |
| 7 | Compliance flags Abdul | All four products DENY instantly. Lending attempting the same call gets `ERR_INSUFFICIENT_ROLE` |
| 8 | Shazia leaves, requests erasure | Vault destroyed, Merkle root survives, audit trail retains `REGISTER, SHRED` |

It ends with a tally: **PKR 340 spent vs PKR 660 under today's per-product flow — 48% less.**

That counterfactual is computed, not asserted: for every origination it prices the full method set the product's policy requires, which is exactly what *"Full KYC/CDD applies"* means in the EWA specification.

**And it ends by refusing to let the number be over-read.** Eight fictional workers at one employer, with placeholder rail costs. It demonstrates the *mechanism*, not the business case. The number that decides the programme is the real duplicate-verification rate from ABHI's historical logs, which no system in the bank currently measures.

## 2.7 · `npm run demo:walkthrough`

The technical sibling — nine steps, terser, aimed at engineers and auditors. It includes one thing the scenario does not: it **tampers with a stored record** and shows `chainValid` flip to `false` with the correct `brokenAt` version.

## 2.8 · `npm run demo:seed`

Seeds six personas covering every decision path, then prints the decision matrix for each against EWA and SBL. If the gateway is running on :8080 it seeds over HTTP so the console has data; otherwise it seeds an in-process ledger and prints the outcomes.

## 2.9 · `npm run gateway:dev`

Starts the HTTP gateway on port 8080. Check it:

```bash
curl http://localhost:8080/health
```

The startup log states exactly what configuration you are running:

```json
{"level":"info","message":"gateway listening","port":8080,
 "ledgerMode":"simulated","hsm":"software","rails":"mocked",
 "warning":"POC CONFIGURATION — not production"}
```

**This entry point cannot become a production deployment.** Set `NODE_ENV=production` and it exits immediately with an explanation, because the simulated ledger, the software HSM and the header-based identity shim each refuse to initialise.

Change the port with `PORT=9000 npm run gateway:dev`.

---

# Part 3 — How the system actually works

## 3.1 · The idea in one paragraph

ABHI verifies the same person repeatedly — wallet, EWA, ASA, salary-backed lending, merchant financing, employer portal — and cannot tell afterwards whether a given CNIC was checked against NADRA's biometrics or simply typed into a spreadsheet by an employer. This POC records **proof that a verification happened**, never the personal data itself. A product asks *"is this person verified well enough for me?"* and gets back `ALLOW`, `STEP_UP`, `FULL_KYC` or `DENY` — plus, on `ALLOW`, a cryptographic proof of just the handful of attributes that product is entitled to see.

## 3.2 · The repository map

```
packages/canonical/    deterministic JSON + type-tagged value encoding
packages/types/        the 6 record types, validators, the PII tripwire
packages/merkle/       salted Merkle tree, proofs, subject-ID derivation
packages/policy/       the decision engine + product policies + governance

chaincode/kyc-registry/  11 functions — the ledger's business logic
services/gateway/        policy, proofs, consent, vault, rails, HTTP, security
apps/console/            zero-build browser UI, 7 screens

network/          Fabric: 3 MSPs, Raft ordering, endorsement policy
vault/            PostgreSQL schema, envelope encryption, crypto-shred
infrastructure/   Kubernetes + Terraform
monitoring/       Prometheus alerting rules
ci-cd/            9-gate pipeline
scripts/          demos, seeding, conformance audit, CNIC gate
tests/            e2e, integration, security
docs/             blueprint, audits, this guide
```

## 3.3 · The four building blocks

**1. The subject ID — how a person becomes a row without becoming identifiable**

```
subject_id = HMAC-SHA256(pepper, normalise(CNIC))
```

`normalise` strips everything that is not a digit, so `61101-1234567-8` from the app and `6110112345678` from the employer's CSV resolve to the **same** subject. Without that shared normalisation the entire premise collapses — you would have two records for one person and never know.

**Hashing a CNIC does not anonymise it.** Thirteen digits is about 10¹³ values, exhaustible against plain SHA-256 on a commodity GPU in hours. The *keyed* construction is what makes on-chain identifiers uncorrelatable to real people. The pepper lives in an HSM and never leaves it.

**2. The Merkle commitment — how you prove one fact without revealing fourteen**

The 14 verified attributes become the leaves of a salted, domain-separated Merkle tree. Only the 32-byte root goes on the ledger.

```
leaf_i = SHA-256(0x00 ‖ salt_i ‖ 0x00 ‖ name_i ‖ 0x00 ‖ canonical(value_i))
node   = SHA-256(0x01 ‖ left ‖ right)
root   = merkle_root(leaves sorted by attribute name, odd nodes promoted)
```

Four details are load-bearing, each with its own test:

| Detail | Without it |
|---|---|
| Per-attribute 32-byte salt | `fatca_status = false` produces one identical leaf hash for every customer in the bank, instantly recognisable on the ledger |
| Domain separation `0x00` / `0x01` | An internal node can be presented as a leaf — the classic Merkle second-preimage attack |
| Sorted by attribute name | The root depends on the order attributes happened to be supplied in |
| Odd nodes **promoted**, not duplicated | Distinct leaf sets produce the same root (the CVE-2012-2459 class of bug) |
| Type tags `s:` `b:` `d:` `n:` | The string `"true"` and the boolean `true` collide onto the same leaf |

This is what lets EWA receive proof of exactly four attributes — verifiable against a root it can check independently — while learning nothing about profession, date of birth, address or account purpose.

**3. The assurance ladder — the distinction ABHI cannot currently make**

| Level | Means | Who may rely on it |
|---|---|---|
| **A0** | A third party asserted a CNIC. Nothing verified | **Nobody.** An origination lead, not an identity |
| **A1** | NADRA Verisys + document authenticity | Limited-tier flows |
| **A2** | A1 + NADRA 1:1 fingerprint, both hands | EWA, ASA |
| **A3** | A2 + live-selfie liveness | SBL, Merchant Financing |

The level must be **derivable from the methods actually performed**. A record claiming A3 without `LIVENESS` in its methods list is rejected at write time — that closes assurance inflation at the ledger, not at the application.

**4. The version chain — how history becomes provable**

Every change appends a new version carrying `previousVersionHash`, the SHA-256 of its predecessor **as stored**.

The subtlety that is easy to get wrong: when v2 is written, v1 is first marked `SUPERSEDED` **and persisted**, and *that* form is what v2 commits to. Hash the pre-supersession form instead and the chain becomes unverifiable from a state export — an auditor recomputing hashes gets a mismatch on every link. There is a dedicated test named `chain-hash-post-supersession` for exactly this.

## 3.4 · The two ports that make this runnable without Docker

The chaincode's business logic is written against a `StateStore` interface, not against Fabric directly:

| Port | Real implementation | POC implementation |
|---|---|---|
| `StateStore` | Fabric's `ChaincodeStub` | `MemoryStateStore` |
| `LedgerPort` | `FabricLedger` (Gateway SDK) | `SimulatedLedger` |
| `Hsm` | `Pkcs11Hsm` | `SoftwareHsm` |
| `VaultStore` | `PostgresVaultStore` | `MemoryVaultStore` |

**The simulator runs the *same business logic* as the chaincode** — same validation, same state machine, same hash chaining. That is what let 47 chaincode tests exist before any network did.

**It provides none of the governance properties.** No endorsement, no ordering, no independent peers. It is a development and demonstration tool, and it throws on startup if `NODE_ENV=production`.

## 3.5 · Why three organizations

```
AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer', 'ABHILendingMSP.peer'))
```

Read aloud: *Compliance, and at least one product organization.* Neither can write alone.

This single line is the entire architectural argument for using a ledger rather than a database. Everything else in this design — the Merkle commitments, the assurance ladder, the vault, crypto-shredding, the policy engine — works identically on PostgreSQL. **What a database cannot give you is a rule that the application layer cannot bypass.**

---

# Part 4 — Tracing one request end to end

Here is what actually happens when a product asks *"can this customer take an EWA advance?"*

```
POST /kyc/verify  { cnic, productId: "EWA", consentId }
```

**Step 1 — Identity.** `callerFrom()` reads the validated mTLS client certificate and derives the MSP and role from it. Outside production it falls back to headers; in production that fallback throws. Identity is never taken from a header where it matters.

**Step 2 — Rate limiting.** Three independent dimensions: per calling product, per subject, and a tighter bucket for Compliance operations. The **per-subject** limit is the one that matters — it blunts enumeration of the customer base and caps a cost-exhaustion attack against paid rails.

**Step 3 — Replay defence.** If the caller supplied a nonce and timestamp, both are checked: the timestamp must sit inside the clock-skew window and the nonce must not have been seen. A signature alone does not stop replay.

**Step 4 — Subject derivation.** `normaliseCnic()` strips formatting and fails closed on anything that is not exactly 13 digits — it never pads or truncates, because a padded CNIC is a different person's CNIC. The HSM then computes the HMAC. The gateway never holds the pepper.

**Step 5 — Policy load.** `getPolicy("EWA")` gives minimum assurance A2, max age 365 days, and the four attributes EWA may see. `assertPolicyUsable()` refuses an unapproved policy in production — without it, `approvedBy` would be a comment rather than a control.

**Step 6 — Ledger read.** `VerifyKYC` returns **facts, not a decision**: assurance level, methods, status, timestamps, the Merkle root. It also asserts that the registry pointer agrees with the record it points at — divergence means a partially-applied write, and failing loudly beats answering from a stale pointer.

**Step 7 — The decision.** A pure function, in this exact order:

```
no record            -> FULL_KYC
SUSPENDED            -> DENY      (outranks everything)
SHREDDED             -> FULL_KYC  (not DENY — they re-onboard)
CNIC expired         -> DENY      (hard stop, never STEP_UP)
assurance too low    -> STEP_UP   (naming only the missing methods)
too old              -> STEP_UP   (re-affirm the strongest method)
otherwise            -> ALLOW
```

Each position is deliberate. Suspension is evaluated first so a frozen customer gets the right reason code. An expired CNIC is a hard stop because no amount of re-scanning fixes an expired document. Assurance is checked before staleness because satisfying the assurance gap also refreshes the age.

**Step 8 — e-CIB.** Runs on every non-DENY outcome. It is a **credit** check, not an identity check, and is architecturally incapable of being skipped by KYC reuse. Conflating the two would be the most dangerous possible misreading of this design.

**Step 9 — Count the saving.** On `ALLOW`, every rail call the full journey *would* have made is recorded as avoided, with its cost. This is the ROI instrumentation, and it is why savings can be measured rather than asserted.

**Step 10 — Authorise disclosure.** `GenerateProof` computes a three-way intersection: what was **requested** ∩ what the customer **consented** to ∩ what the product's **policy** permits. The narrowest always wins. The audit event records exactly which attributes were released.

**Step 11 — Assemble the proof.** The gateway fetches the vault record, has the HSM unwrap the DEK, and decrypts with AES-256-GCM. The AAD is `subjectId ‖ version ‖ pepperEpoch`, which binds the ciphertext to its record — relocate a row onto another customer's `vaultRef` and authentication fails. It then builds the Merkle proof and **verifies it twice**: once against itself, once against the root the ledger actually holds. A proof that fails either check is never returned.

**Step 12 — Respond.**

```json
{ "decision": { "outcome": "ALLOW", "reason": "SUFFICIENT", "policyId": "EWA@v1" },
  "proof": { "merkleRoot": "...", "attributes": [ ... 4 items ... ] },
  "railCallsAvoided": 3, "costAvoidedPkr": 80, "eCibCalled": true }
```

**One rule for integrating teams: a proof bundle is not a session token.** It is evidence of attributes at a point in time, never of current standing. Products must call `/kyc/verify` at decision time. Caching an `ALLOW` beyond the request is a defect — it is the most likely way a well-built system gets misused by a team in a hurry.

---

# Part 5 — The API

Start the gateway first. In the POC, identity comes from two headers; in production it comes from the client certificate.

| Header | Purpose |
|---|---|
| `X-ABHI-MSP` | `ABHIBankMSP`, `ABHILendingMSP` or `ABHIComplianceMSP` |
| `X-ABHI-Role` | `gateway` or `compliance-officer` |
| `Idempotency-Key` | Optional. Safe retries on mutating calls |

## Register a customer

```bash
curl -X POST http://localhost:8080/kyc/register -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHIBankMSP' -d '{"cnic":"61101-1234567-8","originProduct":"WALLET","cnicExpiryAt":"2031-04-11T00:00:00Z","attributes":{"verisys_match":true,"document_authenticity_pass":true,"biometric_match":true,"liveness_pass":false,"cnic_expiry":"2031-04-11","fatca_status":false}}'
```

Runs the rails, builds the Merkle root, writes salts to the vault, commits v1. Returns the assurance level reached and the rail cost incurred.

## Ask whether an existing verification suffices

```bash
curl -X POST http://localhost:8080/kyc/verify -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHILendingMSP' -d '{"cnic":"61101-1234567-8","productId":"EWA"}'
```

Try `"productId":"SBL"` to see `STEP_UP` naming `LIVENESS` only.

## Grant consent, then get a proof

```bash
curl -X POST http://localhost:8080/consent/create -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHIBankMSP' -d '{"cnic":"61101-1234567-8","grantedTo":"ABHILendingMSP","purpose":"EWA_ORIGINATION","scope":["verisys_match","cnic_expiry"],"expiresAt":"2027-01-01T00:00:00Z","evidenceRef":"tc-001"}'
```

Pass the returned `consentId` to `/kyc/verify` and the response includes a proof bundle.

## Suspend — Compliance only

```bash
curl -X POST http://localhost:8080/kyc/suspend -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHIComplianceMSP' -H 'X-ABHI-Role: compliance-officer' -d '{"cnic":"61101-1234567-8","reason":"AML alert","referenceId":"CASE-1"}'
```

Try the same call with `X-ABHI-MSP: ABHILendingMSP` — you get **403 `ERR_INSUFFICIENT_ROLE`**. That is the governance model, enforced.

## Version chain and audit trail

Both reads take a `subjectId`, which is what the operations console uses and
what you should prefer:

```bash
curl 'http://localhost:8080/kyc/history?subjectId=<64-hex>' -H 'X-ABHI-MSP: ABHIBankMSP'
```

Returns every version with `chainValid` and, if broken, `brokenAt`. **In production `chainValid: false` is a P1 security incident, not a data-quality ticket** — it means state was altered outside the chaincode path.

```bash
curl 'http://localhost:8080/audit/events?subjectId=<64-hex>' -H 'X-ABHI-MSP: ABHIBankMSP'
```

Records attribute **names** disclosed, never values.

Get a subject id from a CNIC without putting one in a URL — the derivation
happens inside the HSM boundary:

```bash
curl -X POST http://localhost:8080/subject-id -H 'content-type: application/json' -d '{"cnic":"61101-1234567-8"}'
```

Both endpoints still accept `?cnic=` for the zero-build console in
`apps/console`, but that form is **deprecated**: a CNIC in a query string lands
in browser history, in referrer headers and in every access log on the path.
The gateway's own logger masks it (SEC-15), but redaction only protects the
logs this process writes.

## Employer bulk lookup

```bash
curl -X POST http://localhost:8080/employer/bulk-lookup -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHIBankMSP' -d '{"cnics":["6110112345678","4220176543211","garbage"]}'
```

Every submitted CNIC lands in exactly one of four buckets:

| Bucket | Meaning |
|---|---|
| `activateNow` | Already verified to the required level — activate immediately, zero rail calls |
| `needsOnboarding` | Known but insufficient, or unknown — run the journey |
| `denied` | Suspended by Compliance, or the CNIC has expired |
| `invalid` | Not a well-formed CNIC |

Note the CSV format (no dashes) resolves to the same subject as the app format — that shared normalisation is what makes the whole screen possible.

> When an employment register is configured (production), a fifth bucket `unauthorised` holds CNICs the employer has no demonstrated relationship with. Those are **never looked up**, so the response reveals nothing about whether they exist at ABHI.

## Metrics

```bash
curl http://localhost:8080/metrics
curl http://localhost:8080/metrics/prometheus
```

Calls made, calls avoided, cost incurred, cost avoided, e-CIB calls, biometric lockouts, vault decrypts. This is the ROI measurement surface.

Full contract: `services/gateway/openapi.yaml`.

---

# Part 6 — The console UI

With the gateway running, open `apps/console/index.html`. Zero build step — it is a single file that talks to the API.

| Screen | What to do |
|---|---|
| **KYC Registry** | Register a customer at A2 or A3, watch the rail cost |
| **Verification** | Run VerifyKYC against any product; see the decision badge and reason code, and the proof bundle |
| **Consent** | Grant a scope, then revoke it and watch disclosure stop |
| **History & Audit** | The version chain with per-link integrity, plus the disclosure log |
| **Employer Portal** | Paste CNICs, get the activation split |
| **Compliance** | Suspend, reinstate, crypto-shred. **Switch "Acting as" to a product org and watch the call be rejected** |
| **Dashboard** | Live cost instrumentation and the current product policies |

**The most persuasive two minutes:** register a customer on screen 1, verify for EWA on screen 2 and watch `ALLOW` with zero rail calls, then switch to SBL and watch `STEP_UP — missing: LIVENESS`. Then go to Compliance, suspend as a product org (rejected), suspend as Compliance (works), and return to Verification to see every product deny.

**Design note:** every decision shows its *reason code*, not just the outcome. `STEP_UP — ASSURANCE_LOW — missing: LIVENESS` is legible to a compliance officer in a demo. An unexplained `STEP_UP` is a black box, and black boxes do not get approved.

---

# Part 7 — Running against a real Fabric network

Everything above runs on the simulator. This part needs **Docker**, and it is the part that proves the governance claim.

## Step 7.1 · Prerequisites

- Docker Desktop 24+ with Compose v2
- Fabric 2.5.9 binaries on your `PATH`
- 16 GB RAM, ~40 GB free (roughly 12 containers)
- **Windows: WSL2 required.** Set `git config --global core.autocrlf input` before cloning — CRLF line endings in Fabric's shell scripts produce failures that look like Docker faults

```bash
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh && ./install-fabric.sh --fabric-version 2.5.9 binary docker
export PATH=$PWD/bin:$PATH
```

## Step 7.2 · Credentials

```bash
cp network/.env.example network/.env
```

Compose uses the `${VAR:?}` form, so a missing secret is a loud startup failure rather than a weak default nobody notices.

## Step 7.3 · Bring the network up

```bash
npm run network:up
```

Generates crypto material, creates the genesis block, starts 3 orderers + 3 peers + 3 CouchDB + PostgreSQL, and joins every peer to `kyc-channel`.

## Step 7.4 · Deploy the chaincode

```bash
npm run network:deploy-cc
```

Packages, installs on all three peers, approves for each organization, and commits with the endorsement policy.

**If `checkcommitreadiness` shows `false` for an organization**, that org approved with different parameters. The signature policy string must be **byte-identical** across all three approvals, quote style included. This is the single most common failure here.

## Step 7.5 · The test that matters

```bash
bash tests/fabric/assert-single-org-write-fails.sh
```

This asserts that a transaction endorsed **only** by a product organization does **not** commit, and that the same transaction endorsed by Compliance **plus** a product organization does.

**Exit 0 means the central architectural claim holds. Exit 1 means it is false as deployed.**

Everything else in this POC can be demonstrated on the simulator. This cannot — endorsement is a property of the *network*, not of application code, and only a running network demonstrates it. Until this script has been run, treat "no unilateral write" as argued rather than proven.

## Step 7.6 · Tear down

```bash
npm run network:down
```

Add `PURGE_CRYPTO=yes` to also delete generated crypto material.

---

# Part 8 — Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | Node below 22.6, or TypeScript that needs codegen (parameter properties, enums). Upgrade Node; write plain field assignments |
| `Cannot find package '@abhi/...'` | `npm install` was not run — the workspace symlinks are missing |
| `EADDRINUSE :8080` | Gateway already running. `PORT=9000 npm run gateway:dev` |
| Console shows *gateway unreachable* | Gateway is not running, or on another port. Start it, reload the page |
| `429` on repeated calls | Working as designed — per-subject rate limiting. Wait 60s, or pass `enableRateLimit: false` in a test harness |
| `ERR_PII_DETECTED` | Something CNIC-shaped reached the chaincode. Working as designed. If it is your own test data, check `check:cnic` |
| `ERR_ASSURANCE_MISMATCH` | The claimed level is not derivable from the methods list — e.g. A3 without `LIVENESS` |
| `ERR_VERSION_CONFLICT` | Optimistic concurrency. Re-read the current version and retry |
| `chainValid: false` | **Stop.** State was altered outside the chaincode. In production this is a P1 incident |
| `npm run typecheck` fails but tests pass | Expected and normal — strip-types does not type-check. Fix the types |
| Fabric: `ENDORSEMENT_POLICY_FAILURE` | You did not collect a Compliance endorsement. Check `endorsingOrganizations` |
| Fabric: containers exit immediately | Ports in use from a previous run. `npm run network:down` prunes volumes |

---

# Part 9 — What this POC does not do

Being precise here is what stops the idea dying in a compliance review.

| Not claimed | Why |
|---|---|
| **Removes any CDD obligation** | Full KYC/CDD still applies. What goes away is *re-collecting* what ABHI already verified |
| **Removes e-CIB** | A credit check, not an identity check. It runs at every origination and cannot be skipped by reuse |
| **Removes AML or sanctions screening** | Point-in-time checks against lists that change. Last year's verification says nothing about today's list |
| **Replaces NADRA** | NADRA remains the source of truth. The ledger remembers what NADRA already said, and when |
| **Makes KYC "better"** | It makes it *consistent, versioned and provable*. The quality of any individual verification is unchanged |
| **Stores biometric data** | Only the boolean outcome, as a salted leaf. No template, no image, ever |
| **Is a cryptocurrency** | No token, no mining, no external network |

## Three limits of this build specifically

1. **Fabric has never been started here.** The contract binding, Gateway SDK client, network definition and endorsement policy are all written and type-checked — but *written* is not *proven*. Part 7 closes this in about 30 minutes on a Docker-capable machine. **It is the top priority.**
2. **The PKCS#11 HSM and PostgreSQL vault adapters have never been executed** — no appliance, no database instance. The conformance audit reports these as `UNVERIFIED`, not `IMPLEMENTED`, deliberately.
3. **The duplicate-verification rate is not measured.** It needs ABHI's historical verification logs. The instrumentation exists and `/metrics` exposes it; the data does not live here. **This is the number that decides whether the production programme is worth funding**, and no demo can substitute for it.

## Open questions that engineering cannot answer

| ID | Question | Owner |
|---|---|---|
| **OPEN-A** | How do A0–A3 map to SBP account categories? | Compliance |
| **OPEN-2** | Will ABHI join PBA Consonance, and when? | ExCo |
| **OPEN-3** | Real NADRA per-call costs, volumes, and repeat rate | Finance + Technology |
| **OPEN-4** | Can Compliance resource co-endorsing every status change? | Compliance |
| **OPEN-5** | What assurance level do migrated customers get? | Compliance + ExCo |
| **OPEN-D** | What may the employer portal display about non-employees? | Product + Legal |
| **OPEN-E** | Does crypto-shredding satisfy a statutory erasure right? | External counsel |

---

## Further reading

| Document | Purpose |
|---|---|
| `ABHI_Unified_KYC_Ledger_Blueprint.md` | The 15-section architecture and implementation blueprint |
| `docs/SECURITY_AUDIT.md` | 14 findings with severity, remediation status and sprint assignment |
| `docs/COMPLIANCE_AUDIT.md` | Control matrix and instrument-by-instrument regulatory mapping |
| `docs/GAP_ANALYSIS.md` | Everything deferred, and to which sprint |
| `docs/POC_READINESS.md` | Success criteria assessed; the gate recommendation |
| `services/gateway/openapi.yaml` | Full API contract |
