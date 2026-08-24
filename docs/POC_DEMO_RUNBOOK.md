# KYC In-Chain Automation Platform
## Complete POC Presentation & Demonstration Guide

**System:** ABHI Unified KYC Ledger
**Audience:** Executive sponsor · Compliance · Risk · Product · Engineering
**Prepared:** 23 August 2026
**Supersedes:** `docs/POC_PRESENTATION_PLAN.md`

---

## 0. Read this before anything else

Every step in this runbook was performed against the running application on
23 August 2026 before it was written down. Where a screen does something
different from what you might expect, this document says so rather than
describing the intention.

### The three sentences you must be willing to say out loud

1. **"The ledger holds proof, not data."** No CNIC and no attribute value ever
   reaches it, and `tests/security/controls.test.ts` fails the build if one does.
2. **"This runs on a simulator, not a Fabric network."** It proves the domain
   logic and proves nothing about multi-organisation governance.
3. **"Every rupee figure on screen is modelled."** Finance has not signed the
   unit costs.

### The one number the demo exists to make believable

An A2 customer applying for a Salary-Backed Loan runs **one check instead of
four**. Verified live: `POST /kyc/update` returned `methodsRun: ["LIVENESS"]`.

### Capability labels used throughout

| Label | Meaning |
|---|---|
| `LIVE IN POC` | Works end to end in the running application |
| `PARTIALLY IMPLEMENTED` | Works, but not through every surface you would expect |
| `MOCKED` | Real code path, simulated external provider |
| `SIMULATED` | Real domain logic, none of the governance properties |
| `NOT IMPLEMENTED` | Does not exist. Do not imply it does |
| `FUTURE PRODUCTION FEATURE` | Designed and documented, not built |

### Seven things that would embarrass you if a stakeholder found them first

These were found by walking the running app. Each is addressed at the point in
the runbook where it could bite.

| # | Finding | Where it matters |
|---|---|---|
| F1 | The console never sends a `consentId`, so **no proof is issued through the UI**. The queue's attribute list is *entitlement*, not disclosure | §16, §17 |
| F2 | "Endorsing organisations — ABHI Compliance ✓ ABHI Bank ✓" on the profile is **hardcoded JSX**. No endorsement happens on the simulator | §11, §22 |
| F3 | The Product access tab is a **client-side preview**, not a ledger answer | §11 |
| F4 | Dashboard "Checks reused today" shows a request count beside a **rail-call percentage** — two different denominators | §5 |
| F5 | The capture screen's 3-attempt cap is **client-side only** (`localStorage`). The gateway has the real one | §13, §21 |
| F6 | `npm run numbers` models the employer upload **without staleness or freezes** — it says 65% saved, the app says 37% | §12, §24 |
| F7 | README and RUNNING.md say **11** chaincode functions. The contract exposes **12** | §9, §21 |

---

## Contents

| # | Section | # | Section |
|---|---|---|---|
| 1 | [Executive Presentation Story](#1-executive-presentation-story) | 19 | [Blockchain — Technical](#19-blockchain-explanation-for-technical-audience) |
| 2 | [System Gap Being Solved](#2-system-gap-being-solved) | 20 | [Scalability](#20-scalability-explanation) |
| 3 | [Business Case](#3-business-case) | 21 | [Failure / Reliability](#21-failure--reliability-explanation) |
| 4 | [What the POC Demonstrates](#4-what-the-poc-demonstrates) | 22 | [Security](#22-security-explanation) |
| 5 | [System Architecture](#5-system-architecture) | 23 | [POC vs Production](#23-current-poc-vs-production-architecture) |
| 6 | [Frontend Architecture](#6-frontend-architecture) | 24 | [Demo Customer Dataset](#24-demo-customer-dataset) |
| 7 | [Backend Architecture](#7-backend-architecture) | 25 | [10-Minute Demo](#25-10-minute-demo) |
| 8 | [Database Architecture](#8-database-architecture) | 26 | [20-Minute Demo](#26-20-minute-demo) |
| 9 | [Blockchain Architecture](#9-blockchain-architecture) | 27 | [30-Minute Demo](#27-30-minute-demo) |
| 10 | [On-Chain vs Off-Chain](#10-on-chain-vs-off-chain-data) | 28 | [Full Presenter Script](#28-full-presenter-script) |
| 11 | [Onboarding Demo](#11-complete-customer-onboarding-demo) | 29 | [Stakeholder Q&A](#29-likely-stakeholder-questions--answers) |
| 12 | [Upload / Creation](#12-customer-upload--creation-walkthrough) | 30 | [Pre-Demo Checklist](#30-pre-demo-checklist) |
| 13 | [KYC Verification](#13-kyc-verification-walkthrough) | 31 | [Backup / Failure Plan](#31-backup--failure-plan) |
| 14 | [Customer Update](#14-customer-update-walkthrough) | 32 | [What the POC Proves](#32-what-the-poc-proves) |
| 15 | [KYC Reuse / Multi-Product](#15-kyc-reuse--multi-product-walkthrough) | 33 | [What It Does Not Prove](#33-what-the-poc-does-not-prove) |
| 16 | [Audit Trail](#16-audit-trail-walkthrough) | 34 | [Future Roadmap](#34-future-roadmap) |
| 17 | [Ledger Walkthrough](#17-ledger-walkthrough) | 35 | [Presenter Cheat Sheet](#35-final-presenter-cheat-sheet) |
| 18 | [Blockchain — Non-Technical](#18-blockchain-explanation-for-non-technical-audience) | | |

---

# 1. Executive Presentation Story

## The one-sentence pitch

> ABHI verifies the same customer's identity separately for every product. This
> puts one cryptographic record of each verification on a permissioned ledger,
> so the second product reuses the first product's work instead of paying for it
> again — without any product ever seeing the customer's data.

## The narrative spine

```
CURRENT PROCESS GAP
   ABHI cannot tell whether a CNIC was biometrically verified
   or typed into a spreadsheet by an employer.
      ↓
BUSINESS PROBLEM
   The same person is verified again for every product.
   357 of 1,204 customers (29.7%) have never been checked by anybody.
      ↓
PROPOSED KYC LEDGER
   One record per customer. Proof, not data. Versioned and revocable.
      ↓
CUSTOMER ONBOARDING
   Checks run; the assurance level is DERIVED from what passed.
      ↓
VERIFICATION
   ALLOW / STEP_UP / FULL_KYC / DENY against product policy.
      ↓
LEDGER RECORD
   Salted Merkle root + methods + level. No personal data.
      ↓
CUSTOMER UPDATE
   Append a hash-linked version. The old one is superseded, never edited.
      ↓
KYC REUSE
   A2 customer applying for SBL runs one selfie, not four checks.
      ↓
AUDITABILITY
   Every decision, actor, policy version and disclosure, verifiable from a
   state export alone.
      ↓
BUSINESS VALUE
   Fewer paid rail calls; a consistent identity standard; an activation
   screen ABHI cannot produce today.
      ↓
SCALABILITY
   Stateless gateway, per-subject state, permissioned network.
      ↓
PRODUCTION ROADMAP
   Fabric deployment first. Then HSM, vault, mTLS, real rails.
```

## What the audience sees vs what the system does

| Moment | What they see | What is happening underneath |
|---|---|---|
| Dashboard | "847 confirmed of 1,204" | `GET /dashboard/summary` counts ledger records by assurance level |
| Apply for SBL | One selfie screen, green "we already have…" notice | `POST /kyc/verify` → `decide()` → `STEP_UP`, `missingMethods:["LIVENESS"]` |
| Freeze | Five product tiles flip green→red | One `SuspendKYC` write; every product's next `decide()` returns `DENY` |
| Identity history | Two dated entries | Two `KYCRecord` versions, v2 carrying `SHA-256(v1 as stored)` |

---

# 2. System Gap Being Solved

## What exists today

ABHI onboards the same person through the wallet, EWA, ASA, salary-backed
lending, merchant financing and the employer portal. Each journey verifies
identity independently. Afterwards, nothing in the bank can answer *"was this
CNIC checked against NADRA's biometrics, or asserted by an employer?"* — the two
are stored identically.

Blueprint §2 records the current-state analysis; §2.3.2 covers EWA specifically,
and Part Two §8.2 is the employer bulk upload that produces unverified CNICs.

## The specific inefficiencies

- **Repeated effort.** A customer verified for the wallet in January is verified
  again for EWA in March and again for SBL in June.
- **No reuse across products.** There is no mechanism to consume another
  product's verification, because there is no record of one.
- **No assurance distinction.** An employer-asserted CNIC and a
  fingerprint-matched CNIC are the same row.
- **No activation view.** An employer asking "which of my 1,000 staff can you
  activate today?" cannot be answered.
- **Weak audit position.** Reconstructing what was verified, when, by whom, and
  under which rule requires trusting mutable application logs.

## Why a tamper-evident ledger, specifically

Everything else in this design — Merkle commitments, the assurance ladder, the
vault, crypto-shredding, the policy engine — **works identically on PostgreSQL.**
One thing does not:

```
AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer', 'ABHILendingMSP.peer'))
```

*Compliance, and at least one product organisation.* Neither can write alone.
A database cannot give you a rule the application layer cannot bypass. That
single line is the entire architectural argument. (`network/configtx.yaml`)

## Traditional vs KYC Ledger

| Area | Traditional / current approach | KYC Ledger approach |
|---|---|---|
| Customer KYC | Verified independently per product; no shared record | One record per customer, keyed by a peppered HMAC of the CNIC |
| KYC reuse | Not possible — nothing records what was verified | A product asks and gets `ALLOW` / `STEP_UP` / `FULL_KYC` / `DENY` |
| Verification evidence | Application logs and provider receipts, mutable | Salted Merkle root committed at verification time |
| Audit trail | Reconstructed from logs; requires trusting the operator | Per-subject audit events on the ledger; disclosure recorded by attribute name |
| Data integrity | Row can be edited by anyone with database access | Every version hash-links its predecessor; tampering flips `chainValid` |
| Cross-product reuse | Each product re-collects | Policy decides sufficiency; only missing methods run |
| Operational effort | Full pack every time | Step-up runs one check where one check is what is missing |
| Product scalability | Each new product builds its own KYC integration | A new product adds a policy entry and calls one endpoint |

## What this POC does **not** solve

| Not solved | Why |
|---|---|
| CDD obligations | Full KYC/CDD still applies. What goes away is *re-collecting* what ABHI already verified |
| e-CIB | A credit check, not an identity check. Runs at every origination; architecturally cannot be skipped by reuse |
| AML / sanctions screening | Point-in-time checks against lists that change. `NOT IMPLEMENTED` here |
| Replacing NADRA | NADRA remains the source of truth. The ledger remembers what NADRA said, and when |
| Verification *quality* | Unchanged. This makes it consistent, versioned and provable — not better |
| The existing customer base | Migration is Sprints 13–14, blocked on `[OPEN-5]` |

---

# 3. Business Case

Format: **Current Process → Business Problem → POC Capability → Business Benefit.**
No ROI figure is invented; every number traces to `npm run numbers` or a screen.

### Faster onboarding

Current: every product runs its own full pack.
Problem: a customer already verified to A2 repeats three checks for EWA.
Capability: `POST /kyc/verify` returns `ALLOW` with **zero rail calls** — verified
live: `railCallsAvoided: 3, costAvoidedPkr: 80`.
Benefit: the application proceeds without waiting on external providers.

### Reduced duplicate effort

Current: no record of prior verification.
Problem: paid calls are repeated with no way to know they are repeats.
Capability: rail instrumentation counts every avoided call (`GET /metrics`).
Benefit: duplication becomes **measurable**, which is the precondition for
reducing it. *The rate itself is unmeasured — see `[OPEN-3]`.*

### Reusable verified identity

Current: identity is a per-product artefact.
Problem: the wallet's NADRA match cannot be consumed by lending.
Capability: one record; each product evaluates it against its own policy.
Benefit: verification becomes an asset rather than a repeated cost.

### Better lifecycle management

Current: a change must be propagated product by product.
Problem: batch jobs, drift, and windows where products disagree.
Capability: append a version; every product resolves to it on its next call.
Benefit: no propagation job, no drift window.

### Stronger auditability

Current: mutable logs.
Problem: an inspector must trust ABHI's own systems.
Capability: hash-linked versions verifiable from a state export alone.
Benefit: the evidence stands without trusting the operator.

### Standardised workflow and easier product onboarding

Current: each product builds its own KYC integration.
Capability: a new product adds one entry to `PRODUCT_POLICIES`
(`packages/policy/src/policies.ts`) and calls `/kyc/verify`.
Benefit: policy change is configuration, not integration work.

## The honest position on money

> The **ratio** is real — it falls out of the policy table and the rail cost
> table. The **rupees** are modelled. Finance has not signed the unit costs.

**And a second caveat that moves the number — `[OPEN-F]`.** Consolidated Product
Manual v2 Part Two §9.3 puts a fingerprint *and* a live selfie on every EWA, ASA
and SBL request. Two readings:

- **Transaction authorisation** (per request): not reusable by anything, so some
  of what the demo reports as "avoided" is spend that happens anyway. **The
  savings figure is overstated by that share.**
- **Customer due diligence**: then EWA and ASA are A3, not the A2 configured
  here — which removes EWA's "zero rail calls" claim instead.

Both readings change the business case. Neither can be settled without
Compliance. Documented in `packages/policy/src/policies.ts` (file header).

---

# 4. What the POC Demonstrates

| Capability | Status | Evidence |
|---|---|---|
| Register a customer, derive assurance from checks that passed | `LIVE IN POC` | `/customers/new`, `POST /kyc/register` |
| Decide sufficiency against product policy | `LIVE IN POC` | `POST /kyc/verify`, `packages/policy/src/engine.ts` |
| Step up only the missing method | `LIVE IN POC` | `methodsRun: ["LIVENESS"]` on `POST /kyc/update` |
| Hash-linked version chain with integrity check | `LIVE IN POC` | `GET /customers/{id}/history` → `chainValid` |
| Compliance-only freeze / reinstate | `LIVE IN POC` | Lending → `403 ERR_INSUFFICIENT_ROLE` |
| Freeze propagates to every product with no batch job | `LIVE IN POC` | EWA verify after freeze → `DENY / SUSPENDED` |
| Selective disclosure via Merkle proof | `PARTIALLY IMPLEMENTED` | Works over the API; **the console does not send a consent id** (F1) |
| Employer bulk triage, four buckets | `LIVE IN POC` | `/onboarding`, `POST /employer/bulk-lookup` |
| Crypto-shredding (erasure) | `LIVE IN POC` | `/compliance` → Erasure tab, `POST /kyc/shred` |
| Audit trail with actor, action, product, decision | `LIVE IN POC` | `/audit`, `GET /audit/events` |
| Cost instrumentation | `LIVE IN POC` (figures `MOCKED`) | `GET /metrics` |
| NADRA Verisys / Doc Auth / Biometric / Liveness | `MOCKED` | `services/gateway/src/rails.ts` |
| e-CIB credit check | `MOCKED` | `MockECib`, `services/gateway/src/rails.ts` |
| Core banking profile (name, employer) | `MOCKED` | `services/gateway/src/cbs.ts` |
| Ledger | `SIMULATED` | `SimulatedLedger`, `services/gateway/src/ledger.ts` |
| Fabric network, endorsement, ordering | `NOT IMPLEMENTED` (written, never run) | `network/`, `chaincode/.../contract.ts` |
| Hardware HSM (PKCS#11) | `NOT IMPLEMENTED` (written, never run) | `services/gateway/src/pkcs11-hsm.ts` |
| PostgreSQL vault | `NOT IMPLEMENTED` (written, never run) | `services/gateway/src/postgres-vault.ts`, `vault/schema.sql` |
| Document image upload / storage | `NOT IMPLEMENTED` | Boolean outcomes only — never an image |
| Editing name / address / CNIC | `NOT IMPLEMENTED` | "Update" means assurance step-up |
| AML / sanctions screening | `NOT IMPLEMENTED` | `FUTURE PRODUCTION FEATURE` |
| mTLS / OAuth2 | `NOT IMPLEMENTED` | Header identity; refuses to boot in production |

---

# 5. System Architecture

## Current POC architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser — apps/web (React 19 + Vite + Tailwind)  :5173       │
│  11 routes · persona switcher · zero CDN calls                │
└───────────────────────────┬───────────────────────────────────┘
                            │  /api/*  (vite proxy → :8080)
┌───────────────────────────▼───────────────────────────────────┐
│  Gateway — services/gateway (node:http, zero runtime deps)     │
│  security → rate limit → replay → idempotency → route          │
│  ├── service.ts     orchestration                              │
│  ├── policy engine  packages/policy (pure decide())            │
│  ├── merkle         packages/merkle (salted, domain-separated) │
│  ├── vault.ts       AES-256-GCM, AAD-bound  [MemoryVaultStore] │
│  ├── hsm.ts         pepper + KEK           [SoftwareHsm]       │
│  ├── rails.ts       NADRA + e-CIB          [MockRails]         │
│  └── cbs.ts         name/employer          [MockCbs]           │
└───────────────────────────┬───────────────────────────────────┘
                            │  LedgerPort
┌───────────────────────────▼───────────────────────────────────┐
│  SimulatedLedger → MemoryStateStore                            │
│  runs chaincode/kyc-registry domain logic (12 functions)       │
│  ✗ no endorsement  ✗ no ordering  ✗ no independent peers       │
└───────────────────────────────────────────────────────────────┘
```

## The two ports that make it runnable without Docker

| Port | Production implementation | POC implementation |
|---|---|---|
| `StateStore` | Fabric `ChaincodeStub` | `MemoryStateStore` |
| `LedgerPort` | `FabricLedger` (Gateway SDK) | `SimulatedLedger` |
| `Hsm` | `Pkcs11Hsm` | `SoftwareHsm` |
| `VaultStore` | `PostgresVaultStore` | `MemoryVaultStore` |

The simulator runs the **same domain logic** as the chaincode — same validation,
same state machine, same hash chaining. It provides **none** of the governance
properties, and throws on startup when `NODE_ENV=production`.

## Production-scale future architecture

Everything marked `[FUTURE]` is designed and documented, **not built**.

```
Channels (wallet · EWA · ASA · SBL · merchant · employer portal)
        ↓  mTLS + OAuth2  [FUTURE]
KYC Platform API  (horizontally scaled, stateless)
        ├── Identity verification — real NADRA contracts   [FUTURE]
        ├── AML / sanctions screening                      [FUTURE]
        ├── KYC policy engine        ← exists today
        ├── Secure off-chain vault — PostgreSQL + HSM      [FUTURE: written]
        └── Ledger — Hyperledger Fabric, 3 MSPs, Raft      [FUTURE: written]
                ↓
        Audit / monitoring — Prometheus + alerting         [rules exist]
```

---

# 6. Frontend Architecture

`apps/web` — React 19, Vite 6, Tailwind 3, React Router 7. **No runtime
dependencies are fetched from a CDN**; the presenting room may have no network.

## Routes — `apps/web/src/App.tsx`

| Route | Component | Purpose |
|---|---|---|
| `/` | `DashboardPage.tsx` | Landing metrics, activity chart, needs-attention |
| `/customers` | `CustomersPage.tsx` | Directory: search, filter, paginate, CSV export |
| `/customers/new` | `NewCustomerPage.tsx` | Register a customer the ledger has never seen |
| `/customers/:subjectId` | `CustomerProfilePage.tsx` | Four tabs + the three actions |
| `/queue` | `QueuePage.tsx` | Verification queue, four decision tabs |
| `/queue/:requestId` | `QueuePage.tsx` (`QueueRequestPage`) | One request in full |
| `/apply/:productId` | `ApplyPage.tsx` | Customer-facing product request flow |
| `/onboarding` | `OnboardingPage.tsx` | Employer bulk upload, three-step wizard |
| `/compliance` | `CompliancePage.tsx` | Freeze / reinstate / erasure |
| `/audit` | `AuditPage.tsx` | The inspector's record |
| `/settings/policies` | `PoliciesPage.tsx` | Product policies, read-only |

**Every route is addressable.** A mis-click mid-demo is recoverable by typing
the URL.

## Identity and personas — `apps/web/src/lib/roles.ts`

| Persona | MSP sent as `X-ABHI-MSP` | Can freeze |
|---|---|---|
| Fatima Khan — Compliance Officer | `ABHIComplianceMSP` | Yes |
| Bilal Ahmed — Lending Operations | `ABHILendingMSP` | No |
| Sana Iqbal — Branch Onboarding | `ABHIBankMSP` | No |

Switched via the avatar button, top right. Persisted in `sessionStorage`.

## Design decisions worth naming to a technical audience

- **Customers are addressed by `subjectId`, never CNIC.** A CNIC in a path lands
  in browser history and every referrer header the page emits.
- **The step-up rule is a pure function** in `apps/web/src/lib/verify.ts`
  (`nextStepFor`), separated from rendering so it is testable without a DOM.
  Screens for satisfied checks are **never mounted** — not hidden, not disabled.
- **No second policy engine.** `ApplyPage` branches on nothing; the gateway owns
  the judgement. *(The one exception is `previewDecision()` — see F3, §11.)*

## Tests

`apps/web` — 55 tests under vitest (`npm run test:web`): `StepUpRouter.test.tsx`,
`CaptureScreen.test.tsx`, `A2SblStepUp.e2e.test.tsx`, `verify.test.ts`.

---

# 7. Backend Architecture

`services/gateway` — built on `node:http` with **zero runtime dependencies**, so
the gateway starts anywhere Node 22.6+ runs. Blueprint recommends Fastify for
production; recorded as a deliberate deviation.

## Request pipeline — `services/gateway/src/http.ts`

```
1  callerFrom(req)          mTLS client cert if present; else headers
                            identityFromHeaders THROWS when NODE_ENV=production
2  RateLimiter.check        per product · per subject · tighter for Compliance
3  NonceCache               timestamp window + unseen nonce (when supplied)
4  IdempotencyStore         safe retries on POST /kyc/* and /consent/*
5  route dispatch           exact-match Map, then matchDynamic()
6  recordPresentation()     append to the screens' index (never business logic)
```

## Endpoints

**Write** — `services/gateway/src/http.ts` (`buildRoutes`)

| Endpoint | Service method | Notes |
|---|---|---|
| `POST /kyc/register` | `svc.register` | 201. Runs rails, builds root, commits v1 |
| `POST /kyc/verify` | `svc.verify` / `verifyBySubject` | Accepts `subjectId` **or** `cnic` |
| `POST /kyc/update` | `svc.stepUp` / `stepUpBySubject` | Runs only missing methods |
| `POST /kyc/suspend` | `svc.suspend` | Compliance only |
| `POST /kyc/reinstate` | `svc.reinstate` | Compliance only |
| `POST /kyc/shred` | `svc.shred` | Compliance only. CNIC-keyed |
| `POST /consent/create` | `svc.grantConsent` | 201, returns `consentId` |
| `POST /consent/revoke` | `svc.revokeConsent` | |
| `POST /employer/bulk-lookup` | `svc.employerBulkLookup` | Employer id from **caller**, not body |

**Read** — `http.ts` and `services/gateway/src/directory.ts`

`GET /kyc/history` · `GET /audit/events` · `GET /policies` · `GET /metrics` ·
`GET /metrics/prometheus` · `GET /health` · `GET /customers` ·
`GET /customers/{subjectId}` · `.../history` · `.../consents` · `.../activity` ·
`GET /dashboard/summary` · `GET /dashboard/activity` · `GET /queue` ·
`GET /queue/{requestId}` · `GET /audit` · `GET /employer/sample-list` ·
`POST /subject-id` · `POST /rails/cbs/profile` · `POST /rails/cbs/profiles`

Full contract: `services/gateway/openapi.yaml`.

## Error mapping — `HTTP_STATUS_FOR` in `http.ts`

| Code | HTTP | Meaning |
|---|---|---|
| `ERR_UNKNOWN_MSP` | 401 | MSP not recognised |
| `ERR_COMPLIANCE_ONLY` / `ERR_INSUFFICIENT_ROLE` | 403 | Authority separation |
| `ERR_SUBJECT_NOT_FOUND` | 404 | |
| `ERR_SUBJECT_EXISTS` / `ERR_VERSION_CONFLICT` / `ERR_INVALID_TRANSITION` | 409 | |
| `ERR_NO_VALID_CONSENT` | 403 | |
| `ERR_ATTEMPT_CAP_EXCEEDED` | 429 | Daily biometric cap |
| `ERR_PII_DETECTED` | 400 | PII tripwire — something CNIC-shaped reached the chaincode |

Every response carries `x-correlation-id`; errors return
`{ error, detail, correlationId }`.

---

# 8. Database Architecture

**Say this plainly: there is no live database in this POC.**

| Store | POC implementation | Production | Status |
|---|---|---|---|
| Ledger state | `MemoryStateStore` (`chaincode/kyc-registry/src/memory-state.ts`) | Fabric world state + CouchDB | `SIMULATED` |
| Salt vault | `MemoryVaultStore` (`services/gateway/src/vault.ts`) | `PostgresVaultStore` | `NOT IMPLEMENTED` (written) |
| Core banking | `MockCbs` — derives names from `subjectId` | Real CBS | `MOCKED` |
| Screens index | `PresentationStore` (`presentation.ts`) | Read model / search index | `LIVE IN POC` |

**Restarting the gateway is the reset.** All state is in process memory. The
cohort is deterministic, so restarting twice produces byte-identical figures —
which is what stops the rehearsal and the performance disagreeing.

## The vault schema that exists but has never run

`vault/schema.sql` defines envelope encryption and crypto-shred support.
`services/gateway/src/postgres-vault.ts` is the driver. The conformance audit
reports both as **`UNVERIFIED`** — code exists and type-checks, but no PostgreSQL
instance was available. *Written* and *proven* are different claims.

## What is stored where

| Data | Where it lives | Mutable? |
|---|---|---|
| `subjectId` (HMAC of CNIC) | Ledger record key | No |
| Assurance level, methods, status, dates | Ledger record | Via a new version only |
| Merkle root | Ledger record | No |
| `previousVersionHash` | Ledger record | No |
| Per-attribute 32-byte salts | Vault, AES-256-GCM | Destroyed on shred |
| Attribute values | Vault only | Destroyed on shred |
| Name, employer, designation | Core banking (`MockCbs`) | Yes — display only |
| Raw CNIC | **Nowhere.** Normalised → HMAC → discarded | n/a |

## Scaling story

Blueprint §4 covers indexing and CouchDB selectors. Reads are per-subject and
key-addressed; the directory endpoint paginates (`page`, `pageSize`, capped at
2000). Nothing here has been load-tested — POC_READINESS rates scalability
**NOT ASSESSED**, deliberately.

---

# 9. Blockchain Architecture

## The network as defined (never started)

`network/configtx.yaml`, `network/crypto-config.yaml`, `network/docker-compose.yaml`

- **Three MSPs:** `ABHIBankMSP`, `ABHILendingMSP`, `ABHIComplianceMSP`
- **Ordering:** Raft, 3 orderers
- **Peers:** 3 peers + 3 CouchDB
- **Channel:** `kyc-channel`
- **Endorsement policy:**
  `AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer', 'ABHILendingMSP.peer'))`

## The chaincode — 12 functions

> **F7 — correction.** `README.md` and `docs/RUNNING.md` said "11 functions".
> `chaincode/kyc-registry/src/contract.ts` exposes **12** `@Transaction`
> methods. Use 12. Both files were corrected alongside this runbook;
> `docs/POC_READINESS.md` still carries the old count in one table row.

| # | Function | Type | Purpose |
|---|---|---|---|
| 1 | `RegisterKYC` | write | Commit v1 |
| 2 | `UpdateKYC` | write | Append a hash-linked version |
| 3 | `SuspendKYC` | write | Compliance-only freeze |
| 4 | `ReinstateKYC` | write | Compliance-only release |
| 5 | `RecordConsent` | write | Grant a disclosure scope |
| 6 | `RevokeConsent` | write | Withdraw it |
| 7 | `MarkShredded` | write | Erasure, retaining the audit fact |
| 8 | `GenerateProof` | write | Issue a proof; records disclosure |
| 9 | `VerifyKYC` | read | Return **facts, not a decision** |
| 10 | `GetVersionChain` | read | Chain + `chainValid` + `brokenAt` |
| 11 | `VerifyProof` | read | Validate a bundle against the root |
| 12 | `GetAuditTrail` | read | Per-subject audit events |

Domain logic lives in `registry.ts`; `contract.ts` binds it to Fabric;
`fabric-adapter.ts` adapts `ChaincodeStub` to the `StateStore` port.

## Cryptographic construction — `packages/merkle`

```
subject_id = HMAC-SHA256(pepper, normalise(CNIC))     pepper is HSM-resident

leaf_i     = SHA-256(0x00 ‖ salt_i ‖ 0x00 ‖ name_i ‖ 0x00 ‖ canonical(value_i))
node       = SHA-256(0x01 ‖ left ‖ right)
root       = merkle_root(leaves sorted by attribute name, odd nodes promoted)
```

Five details are load-bearing, each with its own test in `packages/merkle/test`:

| Detail | Without it |
|---|---|
| Per-attribute 32-byte salt | `fatca_status=false` has one leaf hash bank-wide, instantly recognisable |
| Domain separation `0x00`/`0x01` | An internal node can be presented as a leaf — Merkle second-preimage |
| Sorted by attribute name | The root depends on supply order |
| Odd nodes **promoted**, not duplicated | Distinct leaf sets produce the same root (CVE-2012-2459 class) |
| Type tags `s:` `b:` `d:` `n:` | The string `"true"` and boolean `true` collide onto one leaf |

**Hashing a CNIC does not anonymise it.** 13 digits is ~10¹³ values, exhaustible
against SHA-256 on a commodity GPU in hours. The *keyed* construction is what
makes on-chain identifiers uncorrelatable without the pepper.

## The version chain

Every change appends a version carrying `previousVersionHash` — the SHA-256 of
its predecessor **as stored**. The subtlety: when v2 is written, v1 is first
marked `SUPERSEDED` **and persisted**, and *that* form is what v2 commits to.
Hash the pre-supersession form instead and the chain becomes unverifiable from a
state export. Test: `chain-hash-post-supersession`.

**Verified live:**
```
v1  A2  SUPERSEDED  root=d18c7dc7be47  prev=null
v2  A3  ACTIVE      root=45e37b73d51d  prev=88851411281a
chainValid: true   brokenAt: null
```

---

# 10. On-Chain vs Off-Chain Data

| Data | Frontend | Backend | Vault / DB | Ledger |
|---|---|---|---|---|
| Name | Displayed (from CBS) | Read from `MockCbs` | Core banking | **Never** |
| CNIC | **Masked only** (`61101-*****-5`) | Normalised → HMAC → discarded | **Never stored** | **Never** — only the HMAC |
| Documents | Not handled | Not handled | Not stored | **Never** — `NOT IMPLEMENTED` |
| KYC status | Displayed | Read from ledger | — | **Yes** (`ACTIVE`/`SUSPENDED`/`SUPERSEDED`/`SHREDDED`) |
| Verification result | Displayed as level + methods | Derived from rails | Attribute values encrypted | **Yes** — level + methods list |
| Attribute values | Not displayed | Held transiently to build proofs | **Yes**, AES-256-GCM | **Never** — only leaf hashes |
| Salts | Never | Via HSM unwrap | **Yes**, encrypted | **Never** |
| Merkle root / proof | Shown in Technical detail | Assembled and double-verified | — | **Yes** |
| Ledger reference (`txId`) | Shown in Technical detail | Returned by ledger | — | **Yes** |
| Audit event | Displayed | Written | — | **Yes** — attribute **names** only, never values |

## Why each sits where it does

- **CNIC off-chain and un-stored.** It is the primary identifier of a Pakistani
  citizen. Normalisation strips formatting so `61101-1234567-8` and
  `6110112345678` resolve to the same subject; then it becomes an HMAC and is
  discarded.
- **Attribute values in the vault, not the ledger.** A ledger is
  append-only and replicated — the worst possible place for data subject to an
  erasure right. Crypto-shredding works precisely *because* the values are off-chain.
- **Only the root on-chain.** 32 bytes commits to all 14 attributes and lets any
  holder verify a disclosed subset without learning the rest.
- **Audit records names, never values.** "Lending was shown `biometric_match`"
  is the auditable fact. The value is not.

## Does this POC put sensitive data on-chain?

**No — and it is enforced, not merely intended.** `packages/types/src/index.ts`
carries a PII tripwire that structurally walks every payload before it reaches
the chaincode and throws `ERR_PII_DETECTED` on anything CNIC-shaped. A full state
export is asserted clean in `tests/security/controls.test.ts` (control C-07).
Separately, `npm run check:cnic` fails the build on undeclared 13-digit literals
in source.

---

# 11. Complete Customer Onboarding Demo

> Set-up for every walkthrough in §11–§17 is in [§30](#30-pre-demo-checklist).
> Two terminals: gateway on :8080, console on :5173.

# Step 1 — The dashboard

## What I Do
Open `http://localhost:5173/`.

## What the Audience Sees
Three cards — **Confirmed identities 847** (70% of 1,204), **Checks reused today
7**, **Waiting on a check 56**. Below: a seven-day *Verification activity* chart,
a *Confirmation mix* donut (Claimed 357 · ID checked 122 · Fingerprint verified
604 · Fingerprint + selfie 121), *Recent activity*, and *Needs attention*
(3 frozen · 15 CNICs expiring · 64 requests waiting). A footnote: *"Identity
records are being served by the simulator, not a live network."*

## What I Say
> "1,204 customers. 847 have an identity somebody actually checked. The other
> 357 — nearly a third — are CNICs an employer typed into a spreadsheet. Today
> ABHI stores those two things identically. That is the problem in one screen."

## Why This Matters
The 357 is the problem statement. It is not a data-quality issue — it is the
bank being unable to distinguish an assertion from a verification.

## Frontend Mechanism
`apps/web/src/pages/DashboardPage.tsx` → `useApi` → `directory.summary()`,
`directory.dailyActivity(days)`, `directory.audit({pageSize: 6})`.
Charts: `AssuranceDonut.tsx`, `VerificationBarChart.tsx`.

## Backend Mechanism
`GET /dashboard/summary` in `services/gateway/src/directory.ts`. Calls
`service.listSubjects()`, buckets by assurance level, counts `SUSPENDED` and
CNICs expiring within 90 days, reads `presentation.queue()` for queue depth and
pending cost.

## Database Mechanism
`MemoryStateStore` iteration over all subject records. No SQL.

## Blockchain Mechanism
Read-only. `VerifyKYC`-equivalent reads through `SimulatedLedger`.

## Result
The audience has the problem statement and the scale, in ten seconds.

## Demo Checkpoint
Confirmed identities reads **847**. If it does not, the gateway was not restarted
— see §30.

## Technical Deep Dive
Every figure is computed, none typed in. `npm run numbers` reconciles the cohort
and dashboard figures exactly (verified: 847 / 1,204 / 3 frozen / 15 expiring).

## Likely Question
*"Are those real customers?"*

## Recommended Answer
> "No. 1,204 synthetic records, generated deterministically from a fixed seed.
> Real area codes because those are public geography, generated serials, and the
> final digit is deliberately inconsistent with the generated profile so none of
> them is a valid card."

> ### ⚠ F4 — the second card needs a sentence of care
>
> "Checks reused today — **7** — *100% of today's requests*". The **7** is a
> count of requests answered `ALLOW`. The **100%** is `reuseRate`, which is
> `callsAvoided / (callsMade + callsAvoided)` — a **rail-call** ratio. Because
> no rails have run since the gateway booted, `callsMade` is 0 and the ratio is
> 1. Two different denominators in one card, and the same screen says 56 are
> waiting.
>
> **If asked, say:** *"Seven requests were answered from an existing record. The
> percentage underneath is the share of external calls avoided, not the share of
> requests — and it reads 100% because no new checks have been purchased since
> this instance started."* Do not volunteer the percentage.

---

# Step 2 — The customer directory

## What I Do
Click **Customers**. Filter to **Fingerprint verified (A2)**.

## What the Audience Sees
A paginated table — name, employer, confirmation level, status, last verified,
masked CNIC. An **Export CSV** button. 604 A2 rows.

## What I Say
> "This is the operations view. Note the CNIC column — `61101-*****-5`. The full
> number is not in this console, not in a URL, and not in the ledger."

## Why This Matters
Least-privilege made visible. Operators do their job without ever holding the
citizen's primary identifier.

## Frontend Mechanism
`CustomersPage.tsx` → `directory.customers({q, level, status, employer,
expiringSoon, page, pageSize, sort})`. Rendered by `DataTable.tsx`.

## Backend Mechanism
`GET /customers` in `directory.ts` — composes two sources and keeps them
distinct: **ledger** (level, status, methods, dates, version count) and **CBS**
(name, employer, designation, masked CNIC, avatar seed).

## Database Mechanism
`service.listSubjects()` + `cbs.profiles()`. Filtering and sorting in memory;
pagination capped at 2,000 rows.

## Blockchain Mechanism
Read-only.

## Result
The audience sees a real operational surface, not a toy.

## Demo Checkpoint
Filtering to A2 shows **604**.

## Likely Question
*"Where does the name come from, if not the ledger?"*

## Recommended Answer
> "Core banking. The ledger knows this person's identity was confirmed to level
> A2 on this date. It does not know their name — and it never will."

---

# Step 3 — A customer profile

## What I Do
Open any A2 customer. Walk the four tabs.

## What the Audience Sees
A header with avatar, name, status chip, designation · employer, masked CNIC ·
employee code, and two buttons — **Check eligibility** and **Run missing
checks** — plus **Freeze**, which renders only for Compliance and is simply
absent for the other two personas. Left column tabs: *Identity · Identity history · Product access ·
Activity*. Right column: **Customer details** tagged *Core banking*, and
**Consent**.

The Identity card carries a mint **Ledger** tag and reads: *"Identity confirmed ·
Fingerprint verified · 2 days ago · CNIC valid until 19 May 2027"*, with the
assurance ladder (Claimed → ID checked → Fingerprint → + Selfie) and the methods
that passed. Under it: *"Names and employment details come from core banking. The
ledger holds only proof of verification — never personal data."*

## What I Say
> "Two cards, deliberately different colours, because they are two different
> systems. Mint is the ledger. Slate is core banking. That sentence between them
> is the whole compliance argument."

## Why This Matters
The ledger/CBS split is the design's central claim, and here it is visible
rather than asserted.

## Frontend Mechanism
`CustomerProfilePage.tsx` — five parallel `useApi` calls: `directory.customer`,
`.history`, `.activity`, `.consents`, `api.policies`.

## Backend Mechanism
`GET /customers/{subjectId}` → `readCurrentRecord()` + `cbs.profile()` +
`productAccess` derived from `PRODUCT_POLICIES`.

## Database / Blockchain Mechanism
Reads only. `service.recordFor()` reads the current version through the ledger port.

## Demo Checkpoint
The Identity card shows a **Ledger** tag; Customer details shows **Core banking**.

## Technical Deep Dive
Expand **Technical detail** to show `subjectId`, `merkleRoot`, `version`,
`attributeSetId`.

> ### ⚠ F2 — do not point at "Endorsing organisations"
>
> The Technical detail block ends with *"Endorsing organisations — ABHI
> Compliance ✓ ABHI Bank ✓"*. **That line is hardcoded JSX**
> (`CustomerProfilePage.tsx:229-231`). On the simulator no endorsement occurs.
> Saying "Compliance co-endorsed this write" while pointing at it is a false
> claim to a technical audience.
>
> **Do this instead:** scroll past it, or pre-empt it — *"that row is a
> placeholder for what a real network would report; on this simulator there is
> no endorsement, which is exactly why Fabric deployment is the next sprint."*

> ### ⚠ F3 — the Product access tab is a preview
>
> `previewDecision()` (`CustomerProfilePage.tsx:48-80`) re-implements the
> decision rules **in the browser** to answer "what would each product decide?"
> without firing four real verifications. It is honest and useful, but it is not
> a ledger answer. Say *"this is a preview of what each product would decide"* —
> and use `/apply/:productId` (§13) for anything load-bearing.

## Likely Question
*"Is the CNIC recoverable from the subject id?"*

## Recommended Answer
> "No. It is HMAC-SHA256 under a pepper that lives in an HSM and never leaves
> it. Without the pepper the identifier is uncorrelatable — and plain hashing
> would not be enough, because 13 digits is only about 10¹³ values."

---

# 12. Customer Upload / Creation Walkthrough

Two distinct paths exist. **Neither accepts a document image** — that is
`NOT IMPLEMENTED`.

## Path A — Register one customer

# Step 4 — Register a new customer

## What I Do
**Customers → Add customer** (`/customers/new`). Enter CNIC `42101-9988776-3`,
CNIC expiry a future date, *Opening this for* **Earned Wage Access**. Leave
**NADRA record match**, **CNIC document check**, **Fingerprint match** ticked;
leave **Live selfie** unticked. Click **Run the checks and record the identity**.

## What the Audience Sees
Before submitting, a mint note: *"If every selected check passes, this customer
reaches Fingerprint verified."* After: **Identity recorded on the ledger** —
Confirmation level *Fingerprint verified*, Checks that passed, External checks
run *3 · PKR 80*, and the standing sentence: *"The level above was derived from
the checks that actually succeeded. A check that fails simply does not count
towards it — nothing here was asserted."*

## What I Say
> "Four checkboxes, and they are not claims — they are the checks we are about
> to run and pay for. The confirmation level is worked out from which ones came
> back positive. A compromised client cannot assert A3."

## Why This Matters
Assurance inflation is closed **at the ledger**, not at the application.

## Fields and validation

| Field | Rule | Where enforced |
|---|---|---|
| CNIC | Exactly 13 digits after stripping non-digits; **not all-identical** | `normaliseCnic`, `packages/merkle/src/subject.ts` |
| CNIC expiry | Required; RFC 3339 | Form + ledger validation |
| Opening this for | One of the customer-facing products | `CUSTOMER_FACING_PRODUCTS` |
| Checks to run | At least one | Form (`canSubmit`) |

> **Note for §13 of the original brief:** `99999-9999999-9` **is rejected** —
> `normaliseCnic` explicitly bars repeated-digit values. Use the synthetic
> identities in [§24](#24-demo-customer-dataset).

## The trace, end to end

```
Browser  NewCustomerPage.tsx  submit()
   │     attributes = { verisys_match: true, document_authenticity_pass: true,
   │                    biometric_match: true, liveness_pass: false }
   ▼
HTTP     POST /api/kyc/register  →  vite proxy  →  POST :8080/kyc/register
   │     headers: x-abhi-msp, x-abhi-role
   ▼
Gateway  http.ts route → svc.register(tx, input)
   │     ├── normaliseCnic()            fails closed on ≠13 digits
   │     ├── hsm.hmac()                 subjectId; pepper never leaves the HSM
   │     ├── rails.run() per true attr  MOCKED NADRA calls, cost booked
   │     ├── assurance DERIVED from methods that succeeded
   │     ├── merkle root over 14 salted attributes
   │     └── vault.put()                salts + values, AES-256-GCM
   ▼
Ledger   RegisterKYC → assertMethodsWellFormed, assertAssuranceConsistent,
   │                   validateKYCRecord, PII tripwire → commit v1
   ▼
Response { subjectId, version: 1, assuranceLevel, methods, merkleRoot,
   │       railCallsMade, costSpentPkr }
   ▼
UI       Success panel → "Open this customer"
```

## Database Mechanism
Ledger record written to `MemoryStateStore`; salts and values to
`MemoryVaultStore`, encrypted with AAD `subjectId ‖ version ‖ pepperEpoch`.

## Blockchain Mechanism
`RegisterKYC` (`chaincode/kyc-registry/src/registry.ts:104`). Rejects a claimed
level not derivable from the methods list — `ERR_ASSURANCE_MISMATCH`.

## Result
A new v1 record. Rail spend appears on the dashboard.

## Demo Checkpoint
The success panel reads **Fingerprint verified** and **3 · PKR 80**.

## Likely Question
*"What if the fingerprint check fails?"*

## Recommended Answer
> "The level drops to what did pass — ID checked, not Fingerprint verified. It
> is never asserted, so a failure cannot be papered over."

---

## Path B — Employer bulk upload

# Step 5 — Upload an employer's employee list

## What I Do
**Employer Onboarding** (`/onboarding`) → **Use a sample employee list**.

## What the Audience Sees
A three-step wizard (Upload → Review → Activate). After the check, four buckets
over 1,000 employees:

| Bucket | Count | Meaning |
|---|---|---|
| **Ready now** | 228 | Already confirmed to the standard. No check runs |
| **One check needed** | 469 | Known to ABHI. Only the missing method runs |
| **Full onboarding** | 300 | No record at all — genuinely new applicants |
| **Blocked** | 3 | Frozen by Compliance |

The middle bucket breaks down: *274 — needs a more thorough check*; *195 —
confirmed too long ago*. Then **What this upload costs**: without the ledger
**PKR 79,760**, with it **PKR 50,500**, **saved PKR 29,260 — 37% less**, and a
per-method breakdown of the checks that actually run.

Below that, three honesty callouts, all live on screen:
- *"An employer upload is a claim, not a check."* Unknown employees are recorded
  as **Claimed (A0)** — nobody has verified them.
- *"Full KYC/CDD applies at disbursement, not at upload (Product Manual §6.1).
  CNIC screening and the e-CIB check are performed on every origination (§6.3a)
  and are never reused."*
- *"EWA and ASA are capped at PKR 500,000 per employee under SBP Prudential
  Regulation R-6. Identity assurance does not change that ceiling."*

## What I Say
> "A thousand employees. Two hundred and twenty-eight we can activate today with
> no external calls at all. Four hundred and sixty-nine we already know — they
> need one check, not the full pack. Three hundred are genuinely new. **ABHI
> cannot produce this screen today.**"

## Why This Matters
This is the most commercially legible screen in the demo. It is the employer
conversation, answered.

## Frontend Mechanism
`OnboardingPage.tsx` — `directory.sampleEmployerList(1000)` then
`api.employerBulkLookup(list)`. CSV drop supported via `FileReader`
(`.csv,text/csv,text/plain`).

## Backend Mechanism
`POST /employer/bulk-lookup` → `svc.employerBulkLookup(tx, cnics,
'EMPLOYER_BULK', caller.employerId)`. **The employer id comes from the
authenticated caller, never the body.** Costs are priced by the gateway against
its live rail table — the console does not compute them.

## Database Mechanism
Per-CNIC: normalise → HMAC → ledger read → `decide()` against the
`EMPLOYER_BULK` policy. 1,000 CNICs in **14 ms** (POC_READINESS criterion 11).

## Blockchain Mechanism
Reads only. No writes; an upload establishes nothing.

## Security control worth naming — SEC-05
With an employment register configured, CNICs the employer has no demonstrated
relationship with return `NOT_EMPLOYED` and are **never looked up**, so the
response reveals nothing about whether that person banks with ABHI. Seeded in
`server.ts` under `DEMO_EMPLOYER_ID`.

> This control was previously built, tested and reported implemented — but not
> wired to the HTTP route, leaving the endpoint an unrestricted existence oracle.
> That is attack scenario S-5. It is now wired, and the conformance audit
> asserts call site, wiring and mechanism together (`allOf()` in
> `scripts/conformance-audit.ts`). **This is a good story to tell** — it shows
> the review process working.

## Demo Checkpoint
The four buckets total 1,000.

> ### ⚠ F6 — do not quote `npm run numbers` for this screen
>
> `npm run numbers` prints a **modelled** employer upload: 602 ready / 101
> one-check / 297 full, saving **65%**. The screen shows 228 / 469 / 300,
> saving **37%**.
>
> The script applies cohort proportions only. It **ignores staleness and
> freezes**. The screen runs the real `employerBulkLookup` through the real
> policy engine, which is why 195 employees land in "confirmed too long ago".
> **The screen is right; the script is a simplification** — the opposite of what
> `numbers.ts`'s own header claims.
>
> **Quote 37% and PKR 29,260.** If someone has read the script, say: *"That
> block models level distribution only. The screen applies the full policy,
> including the 180-day and 365-day freshness windows, so it is the lower and
> more honest number."*

## Likely Question
*"Does an employer upload create verified customers?"*

## Recommended Answer
> "No, and the screen says so. An upload is a claim. Anyone not already known to
> us is recorded as Claimed — assurance level A0, which grants nothing. No
> product accepts A0."

---

# 13. KYC Verification Walkthrough

## What starts verification

A product calls `POST /kyc/verify` with a `subjectId` or `cnic`, a `productId`,
and optionally a `consentId` and `requestedAttributes`. In the console this is
triggered by **Check eligibility → Open the application** on a profile, or by
opening `/apply/:productId` directly. The panel's own status line is a
client-side *preview* of the same rule and calls nothing.

## The decision engine — `packages/policy/src/engine.ts`

Pure and side-effect-free. Given the same `(record, policy, now)` it always
returns the same output — which is what lets an auditor re-run a historical
decision against the policy version in force at the time.

```
1. no record          → FULL_KYC   (NO_RECORD)
2. SUSPENDED          → DENY       (outranks everything)
3. SHREDDED           → FULL_KYC   (not DENY — they re-onboard)
4. CNIC expired       → DENY       (hard stop, never STEP_UP)
5. assurance too low  → STEP_UP    (naming only the missing methods)
6. too old            → STEP_UP    (re-affirm the strongest method)
7. otherwise          → ALLOW
```

Each position is load-bearing. Suspension is first so a frozen customer gets the
right reason code. An expired CNIC is a hard stop because no amount of
re-scanning fixes an expired document. Assurance is checked before staleness
because satisfying the assurance gap also refreshes the age.

## Product policies — `packages/policy/src/policies.ts`

| Product | Min level | Max age | Attributes disclosable |
|---|---|---|---|
| Earned Wage Access | A2 | 365 d | verisys, biometric, cnic_expiry, fatca |
| Asaan Digital Account | A2 | 365 d | verisys, biometric, cnic_expiry, fatca |
| Salary-Backed Lending | **A3** | **180 d** | + liveness, date_of_birth |
| Merchant Financing | A3 | 180 d | verisys, biometric, liveness, cnic_expiry |
| Employer onboarding | A2 | 365 d | verisys, biometric, cnic_expiry |
| Partner access | A2 | 365 d | verisys, cnic_expiry |
| Wallet | A0 | 365 d | none — it originates records |

Visible read-only at `/settings/policies`, under the banner: *"These settings are
awaiting sign-off by Compliance and the product owner. They are working defaults
for this environment, not approved policy."*

---

# Step 6 — The headline: an A2 customer applies for SBL

> **This is the scene. If you are running short, cut everything else.**

## What I Do
From an **A2** customer's profile, click **Check eligibility**. The dropdown
already reads *Salary-Backed Lending — One more check needed*; select it and
click **Open the application**. (Or type `/apply/SBL?subjectId=<id>` directly.)

## What the Audience Sees
A green notice, then **exactly one screen**:

> ✅ *"We already have your NADRA record match, CNIC document check and
> Fingerprint match checks, so we will not ask again. Just one more step for
> Salary-Backed Lending."*
>
> **Live selfie verification** — *"Look straight at the camera and follow the
> prompt on screen. This confirms a real person is here right now, not a
> photograph."*
> *3 of 3 attempts remaining today.*
> `[ Start face verification ]` `[ Simulate a failed attempt ]`

## What I Say — slowly
> "This customer opened a wallet with us. We ran a NADRA match, a CNIC document
> check and a fingerprint. Three paid external calls. Today they want a
> salary-backed loan, which needs our highest confirmation level.
>
> The system just said: we already have your NADRA match, your CNIC check and
> your fingerprint. One more step.
>
> **One selfie instead of four checks.**"

## Why This Matters
This is the entire commercial premise, on one screen, in the customer's own words.

## Frontend Mechanism
`ApplyPage.tsx` makes **one** call — `verifyKyc({subjectId, productId})` — then
`StepUpRouter.tsx` renders whatever `nextStepFor()` selected. **There is no
client-side branching on assurance level anywhere in that file.** Screens for
satisfied checks are never mounted.

## Backend Mechanism
`POST /kyc/verify` → `svc.verifyBySubject` → policy load → ledger read →
`decide()` → e-CIB → count avoided rails.

**Verified live:**
```json
{"decision":{"outcome":"STEP_UP","reason":"ASSURANCE_LOW",
             "missingMethods":["LIVENESS"],
             "currentAssurance":"A2","requiredAssurance":"A3",
             "ageDays":2,"policyId":"SBL@v1"},
 "railCallsAvoided":0,"eCibCalled":true}
```

## Database Mechanism
One read. **Nothing is written by a verification** — it decides, it does not buy.

## Blockchain Mechanism
`VerifyKYC` returns **facts, not a decision**: level, methods, status, timestamps,
root. The judgement happens in the gateway. It also asserts the registry pointer
agrees with the record it points at — divergence means a partially-applied write,
and failing loudly beats answering from a stale pointer.

## Result
The customer sees one step. Three checks were skipped, and the screen names them.

## Demo Checkpoint
Exactly one capture screen, and the green notice lists three skipped checks.

## Technical Deep Dive
`nextStepFor()` in `apps/web/src/lib/verify.ts`. `SCREEN_FOR` is exhaustive by
construction — adding a `VerificationMethod` without a screen is a TypeScript
error, not a runtime fallthrough that silently skips a check. A `STEP_UP` with no
named method falls back to **full onboarding**: it over-verifies rather than
letting somebody through unchecked.

## Likely Question
*"What if the customer fails the selfie?"*

## Recommended Answer
Click **Simulate a failed attempt** — *"That did not match. Please try once
more."* and the counter drops to 2. Click twice more:

> **"You have used all 3 attempts for today** — This limit protects your account.
> Please try again tomorrow, or visit any ABHI branch where a colleague can
> complete this for you."

> ### ⚠ F5 — be precise about which cap you are showing
>
> The counter on this screen is **client-side**, stored in `localStorage` under
> `abhi.attempts.<day>.<subjectId>.<method>`. The code says so plainly: *"It is a
> courtesy, never a control."* The **real** cap is server-side in
> `services/gateway/src/rails.ts` (`DAILY_ATTEMPT_CAP`, returning
> `429 ERR_ATTEMPT_CAP_EXCEEDED`, counted as `capLockouts` in `/metrics`).
>
> **Say:** *"This warning is a courtesy so the customer is told before burning
> their last attempt. The control that actually protects NADRA's rate limits is
> in the gateway, and clearing browser storage does not move it."*
>
> **Practical:** three simulated failures lock that customer out for the rest of
> the day in your browser. Reset with `localStorage.clear()` in DevTools, or use
> a different customer. See §31.

---

## What happens on each outcome

| Outcome | Screen | Ledger write? | e-CIB called? |
|---|---|---|---|
| `ALLOW` | `ReviewDetails` — the product's own review | No | **Yes** |
| `STEP_UP` | One `CaptureScreen` per missing method | No — until Update | **Yes** |
| `FULL_KYC` | `OnboardingWizard` | No | **Yes** |
| `DENY` | `HardStop` — no capture screen is ever offered | No | **No** (short-circuits before billing) |

> **Critical for honesty:** completing a capture screen **does not write to the
> ledger**. `StepUpRouter`'s `onFinished` is optional and `ApplyPage` passes
> nothing, so finishing the selfie lands on the review screen and the record
> stays at A2 / v1. The ledger write happens through **Run missing checks** (§14) or
> the queue's *"Run … only"*. Never imply the capture screen persisted anything.

## e-CIB — the answer that matters most

`eCibCalled: true` on **every** non-DENY outcome. It is a **credit** check, not
an identity check, and is architecturally incapable of being skipped by KYC
reuse. Live metrics after the seeded day: `ecibCalls: 63` against 64 requests —
the missing one is the single `DENY`.

Conflating the two would be the most dangerous possible misreading of this
design. There are tests whose only job is to prove reuse never displaces the
credit check (`tests/integration/verify-kyc-branches.test.ts`,
`tests/security/api-controls.test.ts`).

---

# 14. Customer Update Walkthrough

## What "update" means here — read this first

**`NOT IMPLEMENTED`:** editing a name, address, phone number or CNIC. None of
those live on the ledger, and the console offers no field for them.

**`LIVE IN POC`:** raising a customer's assurance by running the checks that are
missing, and appending a new hash-linked version.

| Question from the brief | Answer |
|---|---|
| What fields can be updated? | Assurance level, methods, `cnicExpiryAt`, status |
| What cannot? | `subjectId`, any prior version, name/address (not held) |
| What happens to the old data? | v1 is marked `SUPERSEDED` and **retained** |
| Is there versioning? | Yes — every change appends |
| Is the old state preserved? | Yes, and v2 commits to v1 *as stored* |
| New ledger event? | Yes — a new `KYCRecord` version + an `UPDATE` audit event |

> **This POC does not overwrite history.** The brief asked me to flag it if it
> did. It does not — and there is a dedicated test, `chain-hash-post-supersession`,
> guarding the subtle part.

---

# Step 7 — Step the customer up to A3

## What I Do
Back on the profile, click **Run missing checks** → Product **Salary-Backed
Lending** → Reason *"Step-up for SBL application"*. The panel states what is
about to happen — *"This runs Live selfie check and reuses everything already
confirmed"* — and the button reads **Run the check**, singular, because one is
all that is missing. Press it.

## What the Audience Sees
A toast naming what actually ran: *"Live selfie check ran. [Name] is now
fingerprint + selfie."* The Identity card now reads
**Fingerprint + selfie**. The **Identity history** tab now has two entries.

## What I Say
> "The old version is not edited. It is superseded, and it is still there,
> hash-linked to the new one. That is what makes this auditable — and it is why
> a DBA cannot quietly rewrite what we verified last year."

## Why This Matters
Append-only history is the difference between a record and an assertion.

## Frontend Mechanism
`CustomerActions.tsx` → `api.update({subjectId, productId, attributes,
cnicExpiryAt, reason})`. Keyed by `subjectId` — the console holds no CNIC.

## Backend Mechanism
`POST /kyc/update` → `svc.stepUpBySubject`. Computes `missingMethodsFor(record,
required)`, runs **only** those rails, rebuilds the root, appends the version.

**Verified live:**
```json
{"subjectId":"3d81125d…","version":2,"assuranceLevel":"A3",
 "methodsRun":["LIVENESS"]}
```

> **`methodsRun: ["LIVENESS"]`** — one check ran, not four. Read this line out.

## Database Mechanism
v1 → `SUPERSEDED` and **persisted**. v2 written with
`previousVersionHash = SHA-256(v1 as stored)`. New salts and values in the vault
under v2.

## Blockchain Mechanism
`UpdateKYC` — requires a non-empty `updateReason`, re-runs
`assertMethodsWellFormed` and `assertAssuranceConsistent`, then `validateKYCRecord`.

## Result

**Verified live:**
```
versionCount: 2   chainValid: true   brokenAt: null
  v1  A2  SUPERSEDED  root=d18c7dc7be47  prev=null
  v2  A3  ACTIVE      root=45e37b73d51d  prev=88851411281a
```

## Demo Checkpoint
The history tab shows two entries. The Identity card reads **Fingerprint + selfie**.

## Technical Deep Dive
The subtlety: when v2 is written, v1 must be marked `SUPERSEDED` **and persisted
first**, because *that* form is what v2 hashes. Hash the pre-supersession form
and an auditor recomputing hashes from a state export gets a mismatch on every
link.

## Likely Question
*"What if two systems update the same customer at once?"*

## Recommended Answer
> "Optimistic concurrency — the second write gets `ERR_VERSION_CONFLICT` (409).
> The caller re-reads the current version and retries. On a real Fabric network
> the MVCC read-set conflict enforces the same thing at the ordering layer."

---

# 15. KYC Reuse / Multi-Product Walkthrough

**Status: `LIVE IN POC`.** This is not a future-state walkthrough.

## One KYC, multiple products

```
                    Customer
                       │
              Verified KYC Profile
              (level · methods · date · status)
                       │
        ┌──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼
       EWA            ASA            SBL      Merchant Financing
      A2/365        A2/365        A3/180         A3/180
```

| What is reused | What is still checked, every time |
|---|---|
| NADRA Verisys match | e-CIB credit check |
| CNIC document authenticity | Product eligibility (salary, tenure, limits) |
| Fingerprint match | CNIC expiry, at decision time |
| Liveness (where held) | Suspension status |
| | AML / sanctions screening — `NOT IMPLEMENTED` here |

**KYC is never automatically valid forever.** Each policy carries `maxAgeDays`
(180 for SBL and Merchant Financing, 365 for the rest). Past that, the decision
is `STEP_UP` with reason `STALE`, re-affirming the strongest method.

---

# Step 8 — The same customer, now reused

## What I Do
On the customer you just stepped up to A3, click **Check eligibility**. Every
product in the dropdown now reads *Ready to proceed*. Open **Earned Wage
Access**, then repeat for **Salary-Backed Lending**.

## What the Audience Sees
Both land straight on the review screen. No capture screen at all.

## What I Say
> "Same person, two products, two different policies — and neither of them asked
> for anything. The lending product just consumed the wallet's verification. No
> integration between them, no data shared between them."

## Backend Mechanism — verified live

| Product | Outcome | Rail calls avoided | Cost avoided |
|---|---|---|---|
| EWA (A2 / 365 d) | `ALLOW · SUFFICIENT` | 3 | PKR 80 |
| SBL after step-up (A3 / 180 d) | `ALLOW · SUFFICIENT` | 4 | PKR 100 |

## How the existing customer is identified
`normaliseCnic()` strips formatting, then HMAC under the HSM pepper. The employer
CSV format (no dashes) and the app format (with dashes) resolve to the **same**
subject. Without that shared normalisation you get two records for one person and
never know.

## What new ledger event occurs
A verification is a **read**. The decision is recorded as an audit event carrying
`policyId`, so the ledger remains the authoritative record of what rule was in
force when — but no new `KYCRecord` version is created.

## Why this is valuable to ABHI
Every avoided call is a NADRA charge ABHI would otherwise pay twice, and a delay
the customer would otherwise wait through. **The mechanism is proven; the volume
is not** — the duplicate-verification rate needs ABHI's historical logs.

## Demo Checkpoint
Both products land on the review screen with no capture step.

## Likely Question
*"Could another bank consume this?"*

## Recommended Answer
> "Architecturally yes — that is what `PARTNER_READ` is for, and it is
> read-only. Commercially and legally, no: it needs a data-sharing agreement,
> and SBP's direction is the PBA shared e-KYC platform. Joining that requires one
> canonical KYC record per customer, which ABHI does not have. This is that
> record."

---

# 16. Audit Trail Walkthrough

# Step 9 — What an inspector would be handed

## What I Do
Open **Audit Trail** (`/audit`). Filter by action. Click through to a customer.

## What the Audience Sees
A table — *When · Who · What happened · Customer* — with an **Export CSV**
button and a standing callout:

> *"This is the record an SBP inspector would be given. Every entry here
> corresponds to a transaction on the ledger and can be independently verified.
> Nothing in this list can be edited or deleted."*

Actions available as filters: Identity confirmed · Identity updated ·
Verification requested · Frozen by Compliance · Reinstated by Compliance ·
Personal details erased · Consent given · Consent withdrawn.

## What I Say
> "Every decision, who asked, which product, and what was decided. If you have
> just watched me freeze and unfreeze a customer, it is all here in order —
> including the request that was refused while the freeze was on."

## Why This Matters
Auditability is why a bank would fund this. An inspector should not have to
trust ABHI's systems to verify ABHI's history.

## Frontend Mechanism
`AuditPage.tsx` → `directory.audit({action, subjectId, pageSize: 500})`.

## Backend Mechanism
`GET /audit` in `directory.ts` → `presentation.activity()` + CBS names for display.

## Blockchain Mechanism
Per-subject events come from `GetAuditTrail`. Disclosure events record attribute
**names**, never values.

## What is exposed

| Event | Where |
|---|---|
| Customer creation | `IDENTITY_CONFIRMED` |
| KYC verification | `VERIFICATION` with product and decision |
| Approval / rejection | The decision on the verification event |
| Updates | `IDENTITY_UPDATED` |
| Status changes | `FROZEN` / `REINSTATED` / `ERASED` |
| Ledger reference | `txId`, on the profile's Technical detail |
| Timestamp | Every row |
| Actor | MSP + role — e.g. *ABHI Compliance · compliance-officer* |
| History | The profile's Identity history tab |

## Mutable vs tamper-evident

| Information | Where | Mutable? |
|---|---|---|
| Name, employer, designation | Core banking | **Yes** — display data |
| Attribute values, salts | Vault | Rotatable; destroyed on shred |
| Assurance level, methods, status | Ledger record | Only by appending a version |
| Merkle root, `previousVersionHash` | Ledger record | **No** — tampering flips `chainValid` |
| Audit events | Ledger | **No** |

## Demo Checkpoint
Your own demo actions appear at the top, in order.

## Technical Deep Dive
`npm run demo:walkthrough` **tampers with a stored record** and shows
`chainValid` flip to `false` with the correct `brokenAt` version. Run it if a
technical stakeholder pushes.

> **One honesty note, and the screen carries it too:** this list is an **index
> kept for the screens** (`presentation.ts`). The authoritative record is the
> ledger's own per-subject audit trail, which is what an inspection would be run
> against. Every row here corresponds to one of those entries.

## Likely Question
*"How do we know an old record was not altered?"*

## Recommended Answer
> "Each version hashes the one before it, as stored. Recompute the chain from a
> state export and any edit shows up as a broken link — and we report exactly
> which version broke. In production `chainValid: false` is a P1 security
> incident, not a data-quality ticket."

---

# 17. Ledger Walkthrough

## Showing the record directly

Three ways, in increasing technical depth:

1. **Profile → Technical detail** — `subjectId`, `merkleRoot`, `version`,
   `attributeSetId`. *(Skip the endorsement row — F2.)*
2. **`GET /customers/{subjectId}/history`** — the version chain with
   `chainValid` and `brokenAt`.
3. **`npm run demo:walkthrough`** — nine steps including tamper detection.

## What a ledger record contains

| Field | Example (live) |
|---|---|
| `subjectId` | `3d81125d64ef8bba…` (64 hex) |
| `version` | `2` |
| `merkleRoot` | `45e37b73d51d…` |
| `previousVersionHash` | `88851411281a…` (`null` on v1) |
| `assuranceLevel` | `A3` |
| `methods` | `BIOMETRIC_1TO1, DOC_AUTH, LIVENESS, VERISYS` |
| `status` | `ACTIVE` |
| `verifiedAt`, `cnicExpiryAt` | RFC 3339 |
| `attributeSetId` | `ABHI-KYC-ATTRS-v1` |
| `createdTxId` | `tx-c31169a4` |

**Note what is absent:** no name, no CNIC, no address, no attribute value, no
biometric template, no image.

## Selective disclosure — the real demonstration

> ### ⚠ F1 — this cannot be shown from the console
>
> The React console **never sends a `consentId`**, so `/kyc/verify` always
> returns `proof: null` through the UI. The queue's *"What this product may
> see"* panel shows `disclosableAttributes` — **entitlement**, not disclosure —
> and the screen says so itself: *"They are handed over only once the customer's
> consent is recorded and a proof is issued — nothing has been disclosed by this
> request on its own."*
>
> Do **not** say "the product saw 4 of 14 attributes" while pointing at that
> screen. Use the terminal instead.

### What I Do

```bash
npm run demo:seed
```

That registers the demo personas and creates a consent for `61101-1234567-8`
scoped to `ABHILendingMSP`. Then request **five** attributes, one of which EWA is
not entitled to:

```bash
curl -s -X POST http://localhost:8080/kyc/verify -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHILendingMSP' -d '{"cnic":"61101-1234567-8","productId":"EWA","consentId":"<id from seed output>","requestedAttributes":["verisys_match","biometric_match","cnic_expiry","fatca_status","date_of_birth"]}'
```

### What the Audience Sees — verified live

```
outcome: ALLOW | avoided: 3 PKR 80
merkleRoot:     e54c2d3e077390accad6d296...
attributeSetId: ABHI-KYC-ATTRS-v1
attributes disclosed: 4
   - biometric_match = b:1            | pathLen 4
   - cnic_expiry     = s:2031-04-11   | pathLen 4
   - fatca_status    = b:0            | pathLen 4
   - verisys_match   = b:1            | pathLen 3
```

### What I Say

> "I asked for five attributes. I got four. `date_of_birth` was refused —
> not hidden in the response, **absent from it** — because EWA's policy does not
> permit it. Disclosure is the three-way intersection of what was requested, what
> the customer consented to, and what the product's policy allows. The narrowest
> always wins."

### Technical Deep Dive
The type tags are visible: `b:1` is boolean true, `s:2031-04-11` is a string.
Without them, the string `"true"` and the boolean `true` would collide onto the
same leaf. `pathLen` is the Merkle path depth — 3 or 4 for a 14-leaf tree.

Every proof is verified **twice** before it is returned: once against itself,
once against the root the ledger actually holds. A proof failing either check is
refused rather than returned.

## For a non-technical audience

> "Think of it as a tamper-evident seal on a file, not the file itself. We can
> prove to the lending team that this person's fingerprint matched NADRA's
> record and that their CNIC is in date — without showing them the person's name,
> address, or date of birth. And if anyone alters the sealed record afterwards,
> the seal stops matching."

## For a technical audience

> "A salted, domain-separated Merkle tree over 14 attributes. Only the 32-byte
> root goes on the ledger. Disclosure is a proof path per attribute; withheld
> values are mechanically absent — asserted at byte level in three test suites,
> not merely filtered from the response."

---

# 18. Blockchain Explanation for Non-Technical Audience

## Why we are not replacing the database

> "We are not replacing anything. The database still does what databases are
> good at — looking up a customer, filtering a list, running a report. That does
> not change.
>
> What we are adding is a shared record of *what was verified and when*, which
> no single department can quietly change on its own. Today, if somebody with
> database access edited a customer's verification history, there would be no
> reliable way to tell. On this ledger, every record is sealed against the one
> before it, so an edit breaks the seal and shows up.
>
> The customer's personal information does **not** go on it. No names, no CNIC
> numbers, no addresses, no fingerprints. Only a mathematical fingerprint that
> proves a verification happened — and that fingerprint cannot be turned back
> into the person's details.
>
> One more thing, and it is the part that matters most to Compliance: **no single
> part of ABHI can change a customer's verification status alone.** Compliance has
> to co-sign every change. That is not a policy in a document — it is enforced by
> the network itself."

## The four questions non-technical stakeholders actually ask

| Question | Answer |
|---|---|
| "Is this Bitcoin?" | No. No token, no mining, no external network, no energy cost. A permissioned network with three known participants, all of them ABHI. |
| "Is customer data on it?" | No. Proof that a verification happened, never the data. There is an automated check that fails the build if data ever reaches it. |
| "Can we delete a customer's data?" | Yes. The data lives off the ledger, encrypted; we destroy the key, which makes every backup copy unreadable. The *fact* that a verification happened survives, because that is an audit record, not personal data. |
| "What if it breaks?" | The bank keeps operating — see §21. Nothing about lending stops because a ledger node is down. |

---

# 19. Blockchain Explanation for Technical Audience

## Transaction lifecycle — production, on Fabric

```
1  Client (gateway) builds a proposal
      Gateway SDK · services/gateway/src/fabric-ledger.ts
      endorsingOrganizations: [ABHIComplianceMSP, ABHIBankMSP]

2  Endorsement
      Each peer executes the chaincode against its own world state
      and returns a signed read-write set. Execution is simulation —
      nothing is committed yet.

3  Policy check
      AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer','ABHILendingMSP.peer'))
      A product org alone cannot satisfy this.

4  Ordering
      Raft, 3 orderers. Transactions are batched into blocks.
      Ordering does not validate — it sequences.

5  Validation and commit
      Each peer re-checks the endorsement policy, then MVCC-validates
      the read set against current state. A conflicting read set is
      marked invalid and written to the block as invalid.

6  Ledger write
      Block appended. World state updated. Event emitted.

7  Reference returned
      txId persisted on the KYCRecord as createdTxId.
```

## What actually happens in this POC

Steps 1 and 5–7 have analogues in `SimulatedLedger`; **steps 2, 3 and 4 do not
exist**. There is no endorsement, no ordering and no independent peer. The
domain logic executed is identical — same validation, same state machine, same
hash chaining — which is what let 53 chaincode tests exist before any network did.

**Be explicit about this.** "The simulator proves the domain logic and proves
nothing about endorsement or multi-org governance."

## Validation inside the chaincode

`chaincode/kyc-registry/src/guards.ts` and `registry.ts`:

- `guard(ctx, {complianceOnly, role, payload})` — MSP and role authority
- `assertMethodsWellFormed(methods)` — no unknown or duplicate methods
- `assertAssuranceConsistent(level, methods)` — **a record claiming A3 without
  `LIVENESS` is rejected at write time.** Assurance inflation closes at the
  ledger, not the application
- `validateKYCRecord(record)` — shape and the PII tripwire
- `requireNonEmpty(reason, …)` — no unexplained status change

## How the UI gets the final state

Write returns `{subjectId, version, status, txId}`. The console then re-fetches
(`onChanged()` → `detail.reload()`, `history.reload()`, `activity.reload()`) so
the screen reflects committed ledger state rather than an optimistic local guess.

---

# 20. Scalability Explanation

**POC_READINESS rates scalability `NOT ASSESSED`, deliberately.** Nothing below
has been load-tested. These are design properties and their known bottlenecks.

## More customers

State is keyed per subject; every read is key-addressed, not a scan. The one
measured data point: **1,000 CNICs triaged in 14 ms** (POC_READINESS criterion
11, target <60 s). The directory endpoint paginates and caps `pageSize` at 2,000.

`GET /dashboard/summary` currently iterates the whole subject list to bucket by
level — fine at 1,204, **a real bottleneck at millions**. Production needs
materialised counters or a read model. Name this before someone finds it.

## More products

Add one entry to `PRODUCT_POLICIES` (`packages/policy/src/policies.ts`) and call
`/kyc/verify`. No schema change, no chaincode upgrade. Policy deliberately lives
in the gateway, not the chaincode, because product requirements change quarterly
and a chaincode upgrade needs multi-org lifecycle approval. The **decision** is
still written to the ledger carrying `policyId`, so the ledger stays the
authoritative record of what rule was in force when.

## More users, branches, channels

The gateway is stateless per request; identity comes from the client certificate.
Horizontal scaling is straightforward **once the in-process stores are replaced**
— today `MemoryStateStore`, `MemoryVaultStore`, `IdempotencyStore`, `NonceCache`
and `RateLimiter` are all per-process, so a second instance would not share
rate-limit or replay state. Production needs shared backing (Redis or equivalent).
`infrastructure/k8s/gateway.yaml` carries the deployment shape.

## Database

Fabric world state on CouchDB with indexed selectors (Blueprint §4). Reads and
writes separate naturally: verification is read-only, and only register / update /
status changes write. Pagination exists on every list endpoint.

## Blockchain throughput

Fabric on a 3-org network handles the low hundreds of TPS with default block
parameters — comfortably above ABHI's origination volume. The bottlenecks are, in
order:

1. **Endorsement latency** — every write needs a Compliance signature. This is
   the governance property, so it is a cost you are choosing, not a defect.
   `[OPEN-4]` asks whether Compliance can resource it.
2. **Block cut interval** — tunable, trades latency against throughput.
3. **MVCC conflicts** on hot keys — not a concern here; writes are per-subject
   and a single customer is rarely updated concurrently.

**Verification does not write**, so the read path — which is the overwhelming
majority of traffic — never touches consensus at all.

## Permissioned network

| Property | Design |
|---|---|
| Nodes | 3 peers + 3 orderers + 3 CouchDB |
| Participants | ABHI Bank, ABHI Lending, ABHI Compliance |
| Identity | X.509 via each org's MSP; gateway binds the client certificate |
| Permissioning | Channel membership + endorsement policy + chaincode-level role guards |
| Consensus | Raft (crash fault tolerant, **not** Byzantine) |
| Fault tolerance | Raft survives ⌊(n−1)/2⌋ = 1 orderer loss of 3 |

Raft is CFT, not BFT. With all three organisations inside ABHI that is the right
trade. **If PBA Consonance brings in external banks, that assumption needs
revisiting** — flag it rather than letting someone else find it.

## Backend

Yes, horizontally — after the shared-state work above. No sticky sessions; the
console holds no server-side session.

---

# 21. Failure / Reliability Explanation

Behaviour below is what the code actually does. Where the POC does not handle
something safely, it says so.

| Scenario | Actual behaviour | Status |
|---|---|---|
| **Blockchain unavailable** | Verification fails closed — no decision is returned. Products cannot originate against unverified identity | `SIMULATED` — no real network to lose |
| **Database unavailable** | State *is* the process. Gateway restart loses everything and re-seeds deterministically | `POC LIMITATION` |
| **Verification service times out** | `MockRails` never times out. Real timeout, retry and circuit-breaker handling is **`NOT IMPLEMENTED`** | ⚠ Gap |
| **Screening service fails** | AML/sanctions screening does not exist here | `NOT IMPLEMENTED` |
| **e-CIB fails** | `MockECib` always answers. Real degradation policy is a product decision, not built | ⚠ Gap |
| **User retries** | `Idempotency-Key` on `POST /kyc/*` and `/consent/*` returns the original result rather than double-charging a rail | `LIVE IN POC` |
| **Duplicate customer submitted** | `ERR_SUBJECT_EXISTS` (409). The peppered HMAC makes duplicates structurally detectable, including across CNIC formats | `LIVE IN POC` |
| **Two users update the same customer** | `ERR_VERSION_CONFLICT` (409). Re-read and retry | `LIVE IN POC` |
| **Rate limit hit** | `429`. Three dimensions: per product, per subject, tighter for Compliance | `LIVE IN POC` |
| **Replayed request** | Rejected when a nonce and timestamp are supplied — timestamp inside the skew window, nonce unseen | `LIVE IN POC` |
| **Biometric attempt cap** | `429 ERR_ATTEMPT_CAP_EXCEEDED`, `capLockouts` incremented | `LIVE IN POC` (server side — F5) |
| **Chain integrity broken** | `chainValid: false` with `brokenAt`. In production a **P1 security incident** | `LIVE IN POC` |
| **State write succeeds, ledger write fails** | ⚠ **Not handled atomically.** See below | ⚠ Gap |
| **Ledger write succeeds, vault write fails** | ⚠ **Not handled atomically.** See below | ⚠ Gap |

## The two-phase problem — say this before you are asked

The ledger write and the vault write are **not** in a distributed transaction.
A crash between them leaves either:

- a ledger record whose salts are missing → proofs cannot be assembled for that
  version, though the decision path still works; or
- vault rows with no ledger record → orphaned, harmless, but they accumulate.

**Partial mitigation that exists:** `VerifyKYC` asserts the registry pointer
agrees with the record it points at, and fails loudly on divergence rather than
answering from a stale pointer.

**Production solution:** write the vault first and make it idempotent, treat the
ledger commit as the point of truth, and run a reconciliation sweep for orphans.
That work is not in this POC.

## What still works when the ledger is down

Everything that is not identity reuse. Core banking, disbursement, collections
and the existing per-product KYC journeys are untouched. **The failure mode is
"we cannot reuse a verification today", not "the bank stops."** That is the
answer to give an executive worried about a new dependency.

---

# 22. Security Explanation

## Posture

**13 of 16 findings remediated** with regression tests. The 3 remaining are
environmental and **all fail closed**: the software HSM, the simulated ledger and
the header-identity fallback each refuse to initialise when `NODE_ENV=production`.

Full detail: `docs/SECURITY_AUDIT.md` · `docs/COMPLIANCE_AUDIT.md`.

## Controls that are live

| Control | Implementation |
|---|---|
| PII tripwire | Structural walk of every payload; `ERR_PII_DETECTED`. Full state export asserted clean (C-07) |
| CNIC literal gate | `npm run check:cnic` fails the build on undeclared 13-digit literals |
| Log redaction | `services/gateway/src/logging.ts` — SEC-15 |
| Vault AAD binding | AES-256-GCM, AAD `subjectId ‖ version ‖ pepperEpoch`. Relocating a row onto another customer's `vaultRef` fails authentication |
| Vault overwrite before delete | SEC-07 |
| Rate limiting | Per product · per subject · Compliance bucket |
| Idempotency | `Idempotency-Key` on mutating routes |
| Replay defence | Nonce cache + clock-skew window |
| Request signing | Over method, path, body hash, timestamp, nonce |
| Employer roster gate | SEC-05 — CNICs outside the roster are never looked up |
| Consent scope ceiling | SEC-10 — a consent broader than any policy could honour is refused at grant time |
| Authority separation | `ERR_INSUFFICIENT_ROLE`. **Verified live** |
| Policy approval gate | C-11 — refuses to evaluate an unapproved policy in production |
| Production guards | Simulator, software HSM and header identity all throw when `NODE_ENV=production` |

## Known weaknesses — state these plainly

| Weakness | Status | Sprint |
|---|---|---|
| Header-based identity, no mTLS | Refuses to boot in production | 9 |
| Software HSM — pepper and KEK in process memory | Refuses to boot in production | 8 |
| Simulated ledger — no endorsement | Refuses to boot in production | 4 |
| OAuth2 client credentials | Not built | 9 |
| Real rail contracts | Mocked | 4–6 |
| Hardcoded endorsement row in the UI (F2) | Cosmetic but misleading | — |

> **Do not let anyone leave the room thinking this is production-hardened.**

## Erasure and the right to be forgotten

Crypto-shredding: the encryption key is destroyed, which makes every backup copy
of the ciphertext permanently undecryptable. The Merkle root and the audit fact
that a verification happened both survive, because those are audit records, not
personal data.

**`[OPEN-E]` — whether crypto-shredding satisfies a statutory erasure right is a
question for external counsel, not engineering.** Say so.

---

# 23. Current POC vs Production Architecture

| Area | Current POC | Production requirement |
|---|---|---|
| **Identity verification** | `MockRails` — deterministic NADRA stand-ins with cost instrumentation | Contracted NADRA Verisys, Doc Auth, Biometric 1:1; liveness SDK. **Commercial contracting is the long pole and must start at S0** |
| **AML / screening** | `NOT IMPLEMENTED` | Sanctions, PEP and adverse-media screening at origination and on an ongoing basis |
| **Blockchain** | `SimulatedLedger`, in-process | Hyperledger Fabric 2.5.9, 3 MSPs, Raft, CouchDB. Written, never started |
| **Key management** | `SoftwareHsm` from published demo seeds | PKCS#11 HSM, non-extractable pepper and KEK, documented rotation. Driver written, `UNVERIFIED` |
| **Security** | Header identity | mTLS with client-certificate binding, OAuth2 client credentials, request signing |
| **Monitoring** | `/metrics`, `/metrics/prometheus`, alert rules in `monitoring/` | Wired to a real Prometheus + alert routing; on-call runbooks |
| **Disaster recovery** | None. Restart is the reset | Ledger backup and restore, vault PITR, tested RTO/RPO |
| **High availability** | Single process | Multi-replica gateway, multi-peer ledger, shared rate-limit and nonce state |
| **Compliance** | Engineering defaults, `approvedBy: ['PENDING:Compliance','PENDING:ProductOwner']` | Compliance-signed policies; A0–A3 mapped to SBP account categories (`[OPEN-A]`) |
| **Scalability** | `NOT ASSESSED` | Load-tested to projected volume; dashboard aggregation moved off a full scan |
| **External integrations** | CBS mocked; no Mobiliser | Real CBS, Mobiliser, e-CIB, employer payroll feeds |

**This POC works. That does not make it production-ready.** The distinction is
the most credible thing you can say in the room.

---

# 24. Demo Customer Dataset

## How to load it

```bash
npm run demo:seed
```

Seeds over HTTP into the running gateway (falls back to an in-process ledger if
the gateway is not up). Adds these personas **on top of** the 1,204-customer
cohort, and creates a consent for Customer A.

## Safety statement — read before using any of these

- Every identity below is **DEMO / SYNTHETIC**. No real person is represented.
- **No real PII.** No CNIC was copied from any source. Area codes are real
  Pakistani geography — public information, not personal data — and the serial
  digits are generated.
- **All rails are `MOCKED`.** `MockRails` and `MockECib` make no network calls.
  **No synthetic identity is ever sent to a real identity-verification provider.**
  There is nothing to switch to test mode, because nothing external is contacted.
- CNIC rule: exactly **13 digits** after stripping non-digits, and **not
  all-identical**. `99999-9999999-9` is **rejected** by `normaliseCnic`.
- The console carries a permanent **DEMO DATA** badge.

## The scenarios

### Customer A — Happy path · reuse
| | |
|---|---|
| Name | *(generated by `MockCbs` from the subject id)* |
| CNIC | `61101-1234567-8` |
| Product | Earned Wage Access |
| Level | **A2** — Fingerprint verified |
| Verification | `ALLOW · SUFFICIENT` |
| AML / screening | **`NOT IMPLEMENTED`** |
| Purpose | The headline — ALLOW with **zero rail calls** |
| Expected ledger state | v1 `ACTIVE`, methods `VERISYS, DOC_AUTH, BIOMETRIC_1TO1` |
| Expected metrics | `railCallsAvoided: 3`, `costAvoidedPkr: 80`, `eCibCalled: true` |
| Note | The **only** persona with a consent, so the **only** one that can produce a proof bundle (§17) |

### Customer B — Step-up / manual review
| | |
|---|---|
| CNIC | `35202-4455667-9` |
| Product | Salary-Backed Lending |
| Level | **A2**, needs A3 |
| Verification | `STEP_UP · ASSURANCE_LOW`, `missingMethods: ["LIVENESS"]` |
| Purpose | One selfie, not the full pack |
| Expected ledger state | v1 `ACTIVE` — unchanged until an Update is run |
| Expected metrics | `railCallsAvoided: 0`, `eCibCalled: true` |

### Customer C — Rejected / failed
Two variants, because there are two distinct failure shapes.

| | Expired CNIC | Never verified |
|---|---|---|
| CNIC | `17301-5566778-2` | `35202-1122334-5` |
| Level | A3 | **A0** — Claimed |
| Verification | `DENY · CNIC_EXPIRED` | `STEP_UP · ASSURANCE_LOW` (or `FULL_KYC` if no record) |
| Purpose | Hard stop — **never** `STEP_UP` | A0 grants nothing; no product accepts it |
| e-CIB | **Not called** — DENY short-circuits before billing | Called |

### Customer D — Existing verified customer, second product
Reuse **Customer A**, then verify for a second product. This is the point: it is
the *same record*, not a second customer.

| | |
|---|---|
| EWA | `ALLOW`, 3 calls avoided, PKR 80 |
| SBL (after step-up to A3) | `ALLOW`, 4 calls avoided, PKR 100 |

### Customer E — Update / new version
Take **Customer B** and run **Run missing checks → Salary-Backed Lending**.

| | |
|---|---|
| Before | v1 · A2 · `ACTIVE` |
| Backend | `methodsRun: ["LIVENESS"]` — one check, not four |
| After | v1 · A2 · `SUPERSEDED` **retained** + v2 · A3 · `ACTIVE` |
| Chain | `chainValid: true`, v2 `previousVersionHash` = SHA-256(v1 as stored) |

### Customer F — Compliance freeze
| | |
|---|---|
| CNIC | `42201-7654321-1` |
| Level | A3, then `SUSPENDED` (`CASE-2026-114`) |
| Verification | `DENY · SUSPENDED` for **every** product |
| Purpose | Suspension outranks everything; Lending attempting the same write gets `403 ERR_INSUFFICIENT_ROLE` |

### Control — Fresh customer
`42101-9988776-3` is deliberately **not** seeded. Use it at `/customers/new`
(§12) to demonstrate registration from nothing.

## Which screens need a CNIC

Most of the console addresses customers by `subjectId`. Three places need a CNIC
typed in — use the personas above:

| Screen | Why |
|---|---|
| `/compliance` — Freeze / Reinstate | The officer resolves the CNIC once; it stays in component state, never in a URL |
| `/compliance` — Erasure | `POST /kyc/shred` is CNIC-keyed |
| `/queue/:id` — "Run … only" on a `STEP_UP` | A step-up happens with the customer present, so the operator has the card in hand |

---

# 25. 10-Minute Demo

**Executive. Cut everything that is not the argument.**

| Min | Do | Say in one line |
|---|---|---|
| 0–1 | `/` — the dashboard | "1,204 customers. 357 have never been checked by anybody." |
| 1–2 | Point at the *Confirmation mix* donut | "Today those two things are stored identically." |
| 2–3 | Open an A2 customer profile | "Mint is the ledger. Slate is core banking. The ledger does not know their name." |
| 3–6 | **`/apply/SBL` — the headline** | **"One selfie instead of four checks."** |
| 6–7 | Profile → **Run missing checks** → run it | "The old version is superseded, not edited. Still there, hash-linked." |
| 7–8 | `/onboarding` → sample list | "228 activate today with zero external calls. ABHI cannot produce this screen." |
| 8–9 | `/audit` | "This is what an SBP inspector would be handed." |
| 9–10 | The close (§28) | The ask. |

**Skip:** consent, proofs, the queue, policies, chaincode internals.
**Say once, early:** "The money is modelled. The ratio is the claim, not the rupees."

---

# 26. 20-Minute Demo

**Product and technical.** The 10-minute spine, plus:

| Min | Add |
|---|---|
| 2–4 | `/customers` — search, filter to A2, note the masked CNIC |
| 8–10 | `/queue` — four decision tabs. Open a `STEP_UP` row. **Say "may see", not "was shown"** (F1) |
| 10–12 | `/compliance` — freeze as **Lending** (button disabled), switch persona, freeze as **Compliance**, then verify any product → `DENY` |
| 14–16 | `/settings/policies` — seven products, and the *awaiting sign-off* banner |
| 16–18 | Architecture: the two ports, and why policy lives in the gateway not the chaincode |
| 18–20 | Business case (§3) including **`[OPEN-F]`**, then the close |

**The persona switch is the moment.** Do it live on `/compliance`, which is the
screen that keeps the button visible and disabled for exactly this purpose. (A
customer profile omits it for Lending instead of greying it out, so switch to
`/compliance` before you make the point.) The Freeze button is disabled
for Lending — *"that is a courtesy; the real control is the server"* — then show
the 403 in §27 if anyone doubts it.

---

# 27. 30-Minute Demo

**Deep technical.** The 20-minute flow, plus a terminal alongside the browser.

| Min | Add | Command |
|---|---|---|
| 3 | Prove the crypto before claiming anything | `npm run vectors:verify` — 7 pinned vectors |
| 12–14 | **Prove the authority split at the API**, not just the disabled button | the two `curl` calls below |
| 16–19 | **Selective disclosure for real** (§17) | `/kyc/verify` with a `consentId` — 5 requested, 4 returned |
| 19–21 | Tamper detection | `npm run demo:walkthrough` — `chainValid` flips to `false` with `brokenAt` |
| 21–23 | Chaincode surface — the 12 functions, `assertAssuranceConsistent` | `chaincode/kyc-registry/src/registry.ts` |
| 23–25 | Failure handling (§21), including the two-phase gap **stated openly** | |
| 25–27 | Security posture (§22) and the three fail-closed guards | |
| 27–30 | Production architecture (§23) and the close | |

### The authority-split proof — verified live

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:8080/kyc/suspend -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHILendingMSP' -H 'X-ABHI-Role: lending' -d '{"cnic":"61101-1234567-8","reason":"AML alert","referenceId":"CASE-1"}'
```

```
{"error":"ERR_INSUFFICIENT_ROLE",
 "detail":"requires kyc.role=compliance-officer, caller has lending"}
HTTP 403
```

Then the same call as Compliance:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:8080/kyc/suspend -H 'content-type: application/json' -H 'X-ABHI-MSP: ABHIComplianceMSP' -H 'X-ABHI-Role: compliance-officer' -d '{"cnic":"61101-1234567-8","reason":"Sanctions screening match under review","referenceId":"CASE-2026-114"}'
```

```
{"subjectId":"…","version":1,"status":"SUSPENDED","txId":"tx-c31169a4"}
HTTP 200
```

> **Say:** *"On this simulator that rejection is enforced by the chaincode's role
> guard. On a real Fabric network it is enforced twice — the guard, and the
> endorsement policy, which a product organisation cannot satisfy alone.
> **Only the second one is untested here**, and closing that is next sprint."*

---

# 28. Full Presenter Script

Steps 1–9 in §11–§17 carry the full per-step template. This section is the
connective tissue: the opening, the transitions and the close.

## Opening (60 seconds, before any screen)

> "ABHI verifies the same person's identity over and over — wallet, EWA, ASA,
> salary-backed lending, merchant financing, the employer portal. Every product
> does its own. Afterwards, nothing in the bank can tell you whether a given CNIC
> was matched against NADRA's biometrics or typed into a spreadsheet by an
> employer.
>
> What I am going to show you is a working system that records **proof that a
> verification happened** — never the personal data itself — so the second
> product can reuse the first product's work.
>
> Three things before I start, because I would rather you hear them from me.
> This runs on a simulator, not a real blockchain network. Every rupee figure is
> modelled and Finance has not signed the unit costs. And these are 1,204
> synthetic customers, not real ones."

## Transitions that carry the argument

| From → To | Line |
|---|---|
| Dashboard → Profile | "Let me show you what one of those 357 actually looks like next to one we have verified." |
| Profile → Apply | "So this customer wants a salary-backed loan. Watch what the system asks them for." |
| Apply → Update | "That was the customer's view. Here is what it did to the record." |
| Update → Onboarding | "One customer is an anecdote. Here is a thousand." |
| Onboarding → Compliance | "Now the control that makes this a ledger rather than a database." |
| Compliance → Audit | "And everything you have just watched me do is on the record." |

## The close

> "What you have seen is the domain logic, working, with the cryptography tested
> and the limitations on the screen rather than in a footnote. What it is **not**
> yet is a deployed system — no Fabric network, no HSM, no real NADRA contracts.
>
> The next sprint converts the central claim from argued to demonstrated: put the
> chaincode on a real three-organisation network and show that a single
> organisation cannot write a record alone. That is one sprint, and it is the one
> that matters.
>
> The decision I need today is not technical. It is whether Compliance will own
> **`[OPEN-5]`** — what assurance level the existing customer base inherits — and
> whether we can start NADRA contracting this month. Engineering cannot unblock
> either of those, and both are on the critical path."

## The two things to escalate in the room

1. **NADRA contracting is the long pole and it is commercial, not technical.**
   It must start at S0, not S4.
2. **`[OPEN-5]` — what assurance level do migrated customers get?** A Compliance
   decision with direct commercial consequence. Assign too high and the bank
   grants reliance it cannot evidence; too low and the platform launches with a
   base that all needs re-verifying, which destroys the value proposition on day
   one.

---

# 29. Likely Stakeholder Questions & Answers

**Why blockchain?**
> One property, and only one: no single part of ABHI can change a customer's
> verification status alone. Compliance must co-endorse. Everything else in this
> design works on PostgreSQL — Merkle proofs, the assurance ladder, the vault,
> crypto-shredding. What a database cannot give you is a rule the application
> layer cannot bypass.

**Why not PostgreSQL alone?**
> For most of it, PostgreSQL would be fine, and I would say so to anyone who
> asked. The gap is that a DBA or a compromised service account can update a row
> and there is no independent record that it happened. Here the write needs two
> organisations' signatures, and history is hash-linked so an edit is detectable
> from a state export.

**Is customer data stored on-chain?**
> No. Only a salted Merkle root, the assurance level, the methods, the status and
> dates. No name, no CNIC, no address, no biometric template, no image. There is
> an automated PII tripwire that fails the build if data ever reaches it, and the
> full state export is asserted clean in the test suite.

**What happens if the blockchain goes down?**
> Verification fails closed — no decision is returned, so nothing originates
> against an unverified identity. Everything that is not identity reuse keeps
> working: core banking, disbursement, collections, and the existing per-product
> KYC journeys. The failure mode is "we cannot reuse a verification today", not
> "the bank stops."

**What happens when customer information changes?**
> If it is identity assurance, we append a version — the old one is superseded
> and retained, hash-linked. If it is a name or an address, that is core banking
> and never touched the ledger in the first place.

**Can KYC be reused for another Abhi product?**
> Yes, and that is the whole point. Each product has its own policy — minimum
> assurance level, maximum age, and which attributes it may see. The same record
> is evaluated against each one independently.

**How does the system know an old record was not altered?**
> Every version hashes the one before it, as stored. Recompute the chain from a
> state export and any edit shows up as a broken link, and we report exactly
> which version broke. In production that is a P1 security incident.

**How does this scale?**
> Reads are key-addressed per subject and verification never writes, so the
> majority of traffic never touches consensus. 1,000 CNICs triage in 14
> milliseconds. **Honestly: it has not been load-tested, and the dashboard's
> summary currently scans the whole customer list — that would need a read model
> at real volume.**

**What happens if two systems update the same customer?**
> The second gets `ERR_VERSION_CONFLICT`, a 409. It re-reads and retries. On a
> real Fabric network the MVCC read-set check enforces the same thing at the
> ordering layer.

**What happens when a ledger transaction fails?**
> The write does not commit and the caller gets an error with a correlation id.
> **Where this POC is weak: the ledger write and the vault write are not in one
> transaction.** A crash between them leaves an orphan. The production fix is
> vault-first-and-idempotent with a reconciliation sweep, and it is not built.

**How is sensitive data protected?**
> Attribute values and salts are encrypted with AES-256-GCM in a vault off the
> ledger, with the AAD binding each record to its subject and version — so moving
> a row onto another customer fails authentication. The key that wraps them lives
> in an HSM. On the ledger there is nothing to protect, because there is nothing
> personal there.

**What parts are mocked in the POC?**
> NADRA Verisys, document authentication, biometric matching, liveness, e-CIB and
> core banking are all mocked. The ledger is simulated. The HSM is software. The
> PostgreSQL vault and the Fabric network are written but have never been
> executed — the conformance audit reports those as `UNVERIFIED`, not
> `IMPLEMENTED`, on purpose.

**What would production require?**
> Section 23 in full. In priority order: deploy Fabric and prove the endorsement
> claim; contract with NADRA; a real HSM; PostgreSQL; mTLS and OAuth2; AML
> screening; and Compliance sign-off on the policies.

**How does this fit into existing banking systems?**
> It sits beside them. Core banking stays the system of record for the customer.
> This is the system of record for *what was verified*. Products call one endpoint
> and get one of four answers.

**What is the business ROI?**
> The mechanism is proven; the number is not. Every avoided call is instrumented
> and exposed on `/metrics`. **The figure that decides whether the programme is
> worth funding is ABHI's real duplicate-verification rate, and no system in the
> bank currently measures it.** That is `[OPEN-3]`, and I would rather bring you a
> measured number than a modelled one.

**Why is a permissioned blockchain appropriate?**
> Because the participants are known, we need identity on every transaction, and
> we need governance rules the application cannot bypass. We do not need — and do
> not want — an open network, a token, mining, or Byzantine fault tolerance among
> three organisations that are all ABHI.

**What if another bank or product needed the same verified KYC?**
> Architecturally that is `PARTNER_READ`, and it is read-only — partners may not
> write in v1. Commercially it needs a data-sharing agreement. Strategically, SBP
> has advised banks to join the PBA shared e-KYC platform, and joining requires
> one canonical KYC record per customer. ABHI does not have one. This is that
> record.

**Who signed off these policies?**
> **Nobody yet.** They are engineering defaults drawn from the Consolidated
> Product Manual. The screen says so. Compliance sign-off is a Phase 1 exit gate,
> and the system refuses to evaluate an unapproved policy in production.

**Does this replace our credit checks?**
> **No, and this is the most important answer here.** e-CIB runs on every
> origination regardless of identity assurance. It is a credit check, not an
> identity check, and it is architecturally incapable of being skipped by reuse.
> There are tests whose only job is to prove that.

**What about the customer who has never been verified?**
> They get the full Asaan Digital Account journey. Roughly one request in seven
> in this dataset is a new applicant — the system does not pretend otherwise.

**Can a product see data it shouldn't?**
> Disclosure is the three-way intersection of what was requested, what the
> customer consented to, and what the product's policy permits. The narrowest
> always wins, and the withheld values are mechanically absent from the response
> rather than filtered out of it.

**What if a customer asks to be forgotten?**
> Crypto-shredding — we destroy the encryption key, which makes every backup copy
> of the ciphertext permanently undecryptable. The proof that a verification
> happened survives, because that is an audit fact, not personal data. **Whether
> that satisfies a statutory erasure right is a question for external counsel —
> `[OPEN-E]`.**

**Is it secure?**
> For a POC, yes, and the audit is in the repository — 13 of 16 findings
> remediated with regression tests. It is **not production-hardened**: identity
> is header-based today, mTLS and OAuth2 are Sprint 9. The gateway refuses to
> start in production without them.

---

# 30. Pre-Demo Checklist

## Environment

- [ ] Node 22.6 or newer — `node --version`
- [ ] `npm install` has been run
- [ ] `npm run verify` **green** — types, CNIC gate, vectors, tests, conformance
      *(last run: exit 0, MUST requirements 48/48)*
- [ ] `npm run test:web` **green** — 55 console tests
- [ ] **Terminal 1:** `npm run gateway:dev` → `:8080`
- [ ] **Terminal 2:** `npm run dev --workspace @abhi/web` → `:5173`
- [ ] `curl http://localhost:8080/health` returns `{"status":"ok",…}`
- [ ] Gateway log shows `"ledgerMode":"simulated","hsm":"software","rails":"mocked"`
- [ ] Gateway log shows `registered: 1204, frozen: 3`

## Demo data

- [ ] `npm run demo:seed` run **after** the gateway is up
- [ ] **Copy the `consentId` from its output** — §17 needs it
- [ ] Note your A2 customer's `subjectId` for the headline scene
- [ ] `localStorage.clear()` in DevTools, so no attempt cap is pre-burned (F5)

## Screens — open each once before presenting

- [ ] `/` · `/customers` · `/customers/new` · a `/customers/:subjectId`
- [ ] `/apply/SBL?subjectId=…` — **confirm it shows exactly one selfie screen**
- [ ] `/queue` · `/onboarding` · `/compliance` · `/audit` · `/settings/policies`

## Rehearsal

- [ ] **Restart the gateway immediately before presenting.** The demo mutates
      state; a rehearsed step-up leaves the customer at A3 and the headline
      scene will not reproduce
- [ ] Identify your A2 customer **in advance** and keep the URL open
- [ ] Check the projector: confirm the mint reads as green, not grey, from the
      back of the room
- [ ] Have `docs/GAP_ANALYSIS.md` open in a tab
- [ ] Read the seven findings in §0 once more

## The one-line reset

```bash
npm run demo:seed
```

Ctrl-C the gateway, restart it, re-run the seed. Under 30 seconds, and the cohort
is deterministic — the figures come back identical.

---

# 31. Backup / Failure Plan

All of these are legitimate development fallbacks. **None bypasses a security
control.**

| If this breaks | Do this |
|---|---|
| Gateway will not start | Port clash. `PORT=9000 npm run gateway:dev`, and `GATEWAY_URL=http://localhost:9000 npm run dev --workspace @abhi/web` |
| `EADDRINUSE :8080` | A gateway is already running. Reuse it — the data is already seeded |
| Console shows *gateway unreachable* | Gateway is down or on another port. Start it, reload |
| Vite will not start | `apps/console/index.html` is a zero-dependency fallback — open the file directly, no web server needed |
| A screen errors mid-demo | Every route is addressable. Type the URL and carry on |
| Selfie screen says "used all 3 attempts" | Client-side cap (F5). DevTools → `localStorage.clear()` → reload. Or switch customers |
| The step-up already ran in rehearsal | The customer is at A3. Pick another A2 from `/customers?level=A2`, or restart the gateway |
| `429` on repeated calls | Per-subject rate limiting, working as designed. Wait 60 s or use another customer |
| Someone disputes a dashboard number | `npm run numbers` — but **not** for the employer upload (F6) |
| Asked to prove the crypto | `npm run vectors:verify` — 7 pinned reference vectors |
| Asked to prove no PII on the ledger | `npm test`, and point at control **C-07** |
| Asked to prove tamper detection | `npm run demo:walkthrough` — `chainValid` flips with `brokenAt` |
| The whole UI is unavailable | `npm run demo:scenario` — eight fictional workers, nine months, told as a story with a cost tally. **This is the one to show management if nothing else works** |
| Asked something you do not know | *"I don't know — it's in the gap analysis or it isn't, and I'll come back to you."* Better than a guess in front of Compliance |

---

# 32. What the POC Proves

1. **The domain logic works end to end.** Register, verify, step up, suspend,
   reinstate, erase, and the employer split — all against a real policy engine.
2. **Assurance cannot be inflated.** A record claiming A3 without `LIVENESS` is
   rejected at write time, by the ledger, not the application.
3. **Reuse is real and measurable.** An A2 customer applying for SBL runs one
   check. Verified: `methodsRun: ["LIVENESS"]`.
4. **History is append-only and verifiable.** v1 `SUPERSEDED` and retained; v2
   hash-links it; `chainValid` detects tampering and names the broken version.
5. **Authority separation is enforced at the API.** Lending → `403
   ERR_INSUFFICIENT_ROLE`. Compliance → `200`.
6. **A freeze propagates instantly.** One write; every product's next decision is
   `DENY`. No batch job, no integration.
7. **Selective disclosure works.** Five attributes requested, four returned; the
   fifth mechanically absent, not filtered.
8. **No personal data reaches the ledger.** Enforced by a tripwire and asserted
   over a full state export.
9. **Reuse never displaces the credit check.** `eCibCalled: true` on every
   non-DENY outcome — 63 of 64 seeded requests.
10. **The cryptography is reproducible.** Seven pinned reference vectors,
    CI-gated ahead of everything else.

---

# 33. What the POC Does Not Prove

1. **"No unilateral write" — the central architectural claim — is argued, not
   demonstrated.** Endorsement is a property of the *network*, not of application
   code. Fabric has never been started here. `tests/fabric/assert-single-org-write-fails.sh`
   exists to close this in about 30 minutes on a Docker-capable machine.
   **This is the top priority.**
2. **The HSM and PostgreSQL adapters have never executed.** Reported `UNVERIFIED`.
3. **The duplicate-verification rate `r` is not measured.** It needs ABHI's
   historical logs. **This is the number that decides whether the production
   programme is worth funding**, and no demo substitutes for it.
4. **The savings figure may be overstated — `[OPEN-F]`.** If Product Manual §9.3's
   biometric is transaction authorisation rather than CDD, part of what the demo
   counts as avoided is spend that happens anyway.
5. **Nothing about scale.** No load testing. Single process. The dashboard
   summary scans the full customer list.
6. **Nothing about real provider behaviour.** Mocks do not time out, rate-limit,
   return malformed payloads or go down.
7. **Nothing about migrating the existing base.** `[OPEN-5]`.
8. **Nothing about production security.** Header identity, software HSM,
   simulated ledger — all fail closed, none is production.
9. **No AML or sanctions screening exists.**
10. **Compliance has not approved the policies.** They are engineering defaults.

## Open questions engineering cannot answer

| ID | Question | Owner |
|---|---|---|
| `OPEN-A` | How do A0–A3 map to SBP account categories? | Compliance |
| `OPEN-2` | Will ABHI join PBA Consonance, and when? | ExCo |
| `OPEN-3` | Real NADRA per-call costs, volumes, repeat rate | Finance + Technology |
| `OPEN-4` | Can Compliance resource co-endorsing every status change? | Compliance |
| `OPEN-5` | What assurance level do migrated customers get? | Compliance + ExCo |
| `OPEN-D` | What may the employer portal display about non-employees? | Product + Legal |
| `OPEN-E` | Does crypto-shredding satisfy a statutory erasure right? | External counsel |
| `OPEN-F` | Is Product Manual §9.3 CDD or transaction authorisation? | Compliance + Product |

---

# 34. Future Roadmap

| Sprint | Deliverable | Why it is there |
|---|---|---|
| **4** | **Fabric network deployment + `assert-single-org-write-fails.sh`** | **Converts the central claim from argued to proven. Blocked only on Docker.** |
| 4–6 | Real NADRA, e-CIB, CBS integration | **Commercial contracting must start at S0, not S4** |
| 2 | PostgreSQL vault driver in service | Driver written, needs an instance |
| 8 | PKCS#11 hardware HSM | Non-extractable pepper and KEK |
| 9 | mTLS + OAuth2 client credentials | Removes the header shim entirely |
| — | AML / sanctions screening | Not yet scoped |
| — | Read model for dashboard aggregation | Before real volume |
| — | Vault/ledger reconciliation sweep | Closes the two-phase gap (§21) |
| 13–14 | Migration of the existing customer base | Largest workstream. Blocked on `[OPEN-5]` |

## Phase 1 exit gates — none of them engineering

- Compliance sign-off on `PRODUCT_POLICIES`
- `[OPEN-A]` — A0–A3 mapped to SBP account categories
- `[OPEN-F]` — §9.3 settled, and the business case restated accordingly
- `[OPEN-5]` — migrated-customer assurance level agreed
- `[OPEN-3]` — duplicate-verification rate measured from ABHI's logs

---

# 35. Final Presenter Cheat Sheet

**WHAT IS THE PROBLEM?**
→ ABHI verifies the same person for every product and cannot afterwards tell a
biometric verification from an employer's spreadsheet entry. 357 of 1,204
customers have never been checked by anybody.

**WHAT IS THE SOLUTION?**
→ One cryptographic record per customer of every verification, on a permissioned
ledger. Products reuse it instead of repeating it.

**WHY BLOCKCHAIN?**
→ One property: no single part of ABHI can change a verification status alone.
Compliance must co-endorse. Everything else works on PostgreSQL.

**WHERE IS CUSTOMER DATA STORED?**
→ Names and employment in core banking. Attribute values and salts encrypted in
a vault. The CNIC is stored **nowhere** — normalised, HMAC'd inside the HSM,
discarded.

**WHAT IS STORED ON THE LEDGER?**
→ A subject id, a Merkle root, the assurance level, the methods, the status, the
dates, and the previous version's hash. Nothing personal.

**HOW DOES KYC GET VERIFIED?**
→ Checks run against NADRA (mocked here). The assurance level is **derived** from
which ones passed — never asserted by the caller.

**HOW DOES UPDATE WORK?**
→ Append a version. The old one is marked superseded, kept, and hash-linked to
the new one. Nothing is edited.

**HOW DOES KYC REUSE WORK?**
→ The product asks; the engine compares the record to that product's policy and
answers ALLOW, STEP_UP, FULL_KYC or DENY. STEP_UP names only the missing methods.

**HOW DOES THIS HELP ABHI?**
→ Fewer paid external calls, a consistent identity standard across products, an
employer activation screen ABHI cannot produce today, and an audit position that
does not require trusting our own logs.

**HOW DOES IT SCALE?**
→ Reads are per-subject and verification never writes, so most traffic never
touches consensus. Honestly: not load-tested, and the dashboard summary would
need a read model at real volume.

**WHAT DOES THE POC PROVE?**
→ The domain logic, the cryptography, the decision engine, append-only history,
authority separation at the API, and that reuse never displaces the credit check.

**WHAT DOES IT NOT PROVE?**
→ Endorsement — the central claim — because Fabric has never been started. Also
scale, real provider behaviour, migration, and production security. And the
duplicate-verification rate, which is the number the funding decision rests on.

---

## The three sentences, one last time

1. **"The ledger holds proof, not data."**
2. **"This runs on a simulator. It proves the domain logic and nothing about
   multi-org governance."**
3. **"Every rupee figure is modelled. Finance has not signed the unit costs."**

> Say them before you are asked. The fastest way to lose a Compliance audience is
> to be caught overstating something small. The fastest way to win one is to name
> your own limitations before they do.

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/RUNNING.md` | How to run it, and how it works, end to end |
| `ABHI_Unified_KYC_Ledger_Blueprint.md` | The 15-section architecture blueprint |
| `docs/SECURITY_AUDIT.md` | Findings with severity and sprint assignment |
| `docs/COMPLIANCE_AUDIT.md` | Control matrix and regulatory mapping |
| `docs/GAP_ANALYSIS.md` | Everything deferred, and to which sprint |
| `docs/POC_READINESS.md` | Success criteria assessed; the gate recommendation |
| `services/gateway/openapi.yaml` | Full API contract |
