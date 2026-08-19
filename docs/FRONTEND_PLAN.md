# ABHI Identity Hub — Frontend Rebuild Plan (reconciled)

**Status:** supersedes `Downloads\FRONTEND_PLAN.md`, which was written against a repository
layout that does not exist. Reconciled against the working tree on **18 Aug 2026**.

**Target:** `apps/web/` · **Gateway:** `services/gateway` on `PORT` (default 8080)
**Build window:** Fri 21 Aug and Sat 22 Aug 2026 · **Presented:** Mon 24 Aug 2026

The intent of the original plan is unchanged and is good: replace the tabbed technical
console with an operations console a banker would believe already exists, and put plain
language on every visible surface. What follows corrects the parts that would have sent
the build down roads the repository does not have.

---

## 0. Reconciliation register

Read this section before anything else. Each row is a place the original plan and the
repository disagree; in every case the repository wins.

### 0.1 Layout and tooling

| Original plan | Repository | Resolution |
|---|---|---|
| `web/` holds five demo scenes `Scene1`…`Scene5` | `apps/console/index.html` — one 385-line vanilla HTML/JS file with seven tabs: KYC Registry, Verification, Consent, History & Audit, Employer Portal, Compliance, Dashboard. The string "Scene" appears nowhere. | Build into `apps/web/`, not `web/` — `apps/*` is already a workspace glob in the root `package.json`, so no root manifest edit is needed. Keep `apps/console` untouched until `apps/web` is demo-ready; it is the fallback if Saturday overruns. |
| `services/mock-rails` is a service with a seeded RNG | `services/gateway/src/rails.ts` — `MockRails` and `MockECib` classes running in-process. No `/rails/*` HTTP routes exist. | Rail state is reachable only through `GET /metrics`. See §4.3. |
| `packages/schema` arbitrates policy | `packages/policy/src/policies.ts` exports `PRODUCT_POLICIES` | Read policy from `GET /policies`, which already serves that object verbatim. |
| `make demo` / `reset` / `seed` / `test` / `numbers` | No Makefile. npm scripts: `demo:seed`, `demo:walkthrough`, `demo:scenario`, `verify`, `test`, `vectors:verify`, `audit:conformance`, `gateway:dev`. | Use the npm scripts. `make numbers` has no equivalent and one must be written — see §4.6. |
| `scripts/seed/` generates ~1,200 synthetic subjects | `scripts/seed-demo.ts` (6 personas) and `scripts/dummy-data.ts` (one employer, 9 employees) | The 1,200-record cohort does not exist. Generating it is new work, not enrichment — see §4.5. |
| Build Guide Steps 15 / 23 / 24, including the `curl` gate | No Build Guide in the repository. `ABHI_Unified_KYC_Ledger_Blueprint.md` and `docs/RUNNING.md` are the operative documents. | The gate to protect is `npm run verify` (type check → CNIC literal gate → reference vectors → tests → conformance audit). It must still pass after this work. |
| React, Vite, Tailwind, lucide-react, `@fontsource/inter` | Zero runtime dependencies, no build step, Node 22 `--experimental-strip-types` | Confirmed as the chosen stack. It is contained: `apps/web` gets its own `package.json` with **devDependencies only**, its own `tsconfig.json`, and builds to static assets. The gateway, packages and chaincode keep their zero-runtime-dependency property, which is the claim that actually matters. Both root gates already ignore `apps/**` — the root `tsconfig.json` uses an explicit `include` allowlist covering only `types`, `packages`, `chaincode`, `services/*/src`, `scripts` and `tests`, and the root `test` globs match the same shape. So `npm run verify` is insulated from the web build with no edit; the standing requirement is simply never to add `apps/**` to either. Note `scripts/**/*.ts` **is** typechecked, so the new scripts in §4.5 and §4.6 must stay type-clean. |

### 0.2 Endpoints — §4.1 of the original plan is wrong in both directions

Actual routes, from `services/gateway/src/http.ts:119-257`:

```
POST /kyc/register      { cnic, attributes, originProduct, cnicExpiryAt }        → 201
POST /kyc/verify        { cnic, productId, consentId?, requestedAttributes? }    → 200
POST /kyc/update        { cnic, productId, attributes, cnicExpiryAt, reason }    → 200
POST /kyc/suspend       { cnic, reason, referenceId }                            → 200
POST /kyc/reinstate     { cnic, reason, referenceId }                            → 200
POST /kyc/shred         { cnic, reason, legalBasis }                             → 200
POST /consent/create    { cnic, grantedTo, purpose, scope[], expiresAt, evidenceRef } → 201
POST /consent/revoke    { cnic, grantedTo, consentId, reason }                   → 200
POST /employer/bulk-lookup { cnics[] }                                           → 200
GET  /kyc/history       ?cnic=                                                   → version chain
GET  /audit/events      ?cnic=                                                   → { events: AuditEvent[] }
GET  /policies                                                                   → PRODUCT_POLICIES
GET  /metrics                                                                    → rails + eCib + vault + ledgerMode
GET  /metrics/prometheus
GET  /health
```

Corrections against the original §4.1 and §4.2:

- **`/subject-id` does not exist.** Subject IDs are derived inside the service and never
  exposed for lookup. This matters for routing — see §2.2.
- **`/kyc/batch-verify` does not exist.** The bulk path is `POST /employer/bulk-lookup`,
  and it takes `{ cnics[] }`, returning `{ total, activateNow[], needsOnboarding[],
  denied[], invalid[], unauthorised[] }` — CNIC arrays, not per-row decisions.
- **`/kyc/reinstate` already exists.** The original plan lists it as missing.
- **Erasure already exists as `POST /kyc/shred`**, not `/kyc/erase`. It takes
  `{ cnic, reason, legalBasis }`. Do not add a second endpoint; use this one.
- **`/rails/verisys`, `/rails/biometric`, `/rails/liveness`, `/rails/doc-auth`,
  `/rails/ecib`, `/rails/summary`, `/rails/reset` do not exist as HTTP routes.**
  `GET /metrics` returns `{ rails: { callsMade, callsAvoided, costSpentPkr,
  costAvoidedPkr, capLockouts, byMethod }, ecibCalls, vaultDecrypts, ledgerMode }`.
  That is the only rail surface the frontend can read.
- **`/kyc/verify` takes `productId`, not `product`.**
- **`/kyc/register` takes `cnicExpiryAt` and no `methods` array** — the methods are
  derived from the attributes supplied.
- Endpoints the original plan does not mention but the app needs: `/consent/create`,
  `/consent/revoke`, `GET /kyc/history`, `GET /audit/events`.

### 0.3 The cost figures do not reconcile

Every money figure in the original plan is unreachable from this repository.
`services/gateway/src/rails.ts:22` defines the only cost table that exists:

| Method | Provider | Unit cost |
|---|---|---|
| `ASSERTED` | none | PKR 0 |
| `VERISYS` | NADRA Verisys | PKR 25 |
| `DOC_AUTH` | NADRA doc auth | PKR 15 |
| `BIOMETRIC_1TO1` | NADRA biometric | PKR 40 |
| `LIVENESS` | liveness provider | PKR 20 |

With `REQUIRED_METHODS` from `packages/types/src/index.ts:61`, a full journey costs:

| Level | Methods | Cost |
|---|---|---|
| A0 | asserted | **PKR 0** |
| A1 | Verisys + doc auth | **PKR 40** |
| A2 | + fingerprint | **PKR 80** |
| A3 | + liveness | **PKR 100** |

So the original plan's `4 checks · 6.5 seconds · PKR 205` is wrong twice: A2 is three
checks, not four, and the cost is PKR 80. The employer figures (`PKR 205,000` /
`PKR 133,150` / `PKR 71,850 saved`) all derive from an invented PKR 205 per head and
cannot be shown. Likewise the dashboard's `PKR 12,480` and `PKR 71,850 avoided`.

**Three rules follow, and none of them is optional.**

1. Every displayed figure is computed from `DEFAULT_RAIL_COSTS` and live `GET /metrics`.
   No number is typed into a component.
2. The cost table is labelled in the repository as *"PLACEHOLDER GRID POINTS, not ABHI
   numbers"*, open item `[OPEN-3]`, to be supplied by Finance. The UI must say so where
   money is shown. A single line under the spend card — *"Unit costs are modelled
   placeholders, not ABHI's contracted rates"* — is enough, and it is the difference
   between a model and a claim.
3. Nothing on screen presents a saving as an ABHI measurement. The repeat-verification
   rate, the per-call cost and the volumes are all unmeasured.

This is a correction to the original plan's §5.1 note, which told the builder to make the
numbers reconcile with a rail table it named but did not read.

### 0.4 Product policy — settled

The original plan §11 flags a disagreement between two source documents and names
`packages/schema` as arbiter. The real arbiter is `packages/policy/src/policies.ts`, and
it settles it: **SBL and Merchant Financing are A3 with a 180-day maximum age.** The idea
document wins; the POC Plan §5.4 is stale and should be corrected before Monday, since
both may be read in the room.

Two further facts the original plan did not anticipate:

- **There are seven policies, not four**: EWA (A2/365), ASA (A2/365), SBL (A3/180),
  MERCHANT_FINANCING (A3/180), EMPLOYER_BULK (A2/365), PARTNER_READ (A2/365),
  WALLET (A0/365). §5.3 forbids hardcoding the product list, so the Product access tab
  will render all seven — including a `WALLET / A0` row that reads oddly to a viewer.
  Filter to the four customer-facing products **in the view layer, from a named constant
  with a comment**, rather than hardcoding a product list.
- Every policy carries `approvedBy: ['PENDING:Compliance', 'PENDING:ProductOwner']` and
  `effectiveFrom: 2026-09-01`. Neither is enforced outside production
  (`assertPolicyUsable` only fails when `NODE_ENV=production`; `effectiveFrom` is never
  read), so there is no demo-day landmine. But the policies screen renders both fields,
  and an effective date *after* the presentation date invites a question. Either show the
  pending-approval state deliberately — it is honest, and it supports §5.8's "changing a
  policy is a governed action" — or move `effectiveFrom` back. Do not hide it.

### 0.5 What the original plan assumed exists and does not

- **No core banking mock of any kind.** §4.4's `/rails/cbs/profile` is entirely new. Since
  the ledger holds no personal data, there is no other source for names, employers or
  designations — without this the customer directory cannot render a single row.
- **No 1,200-record cohort.** Six personas and a nine-person workforce.
- **No global audit feed.** `GET /audit/events` requires a `cnic`. §5.7's audit screen has
  no endpoint behind it.
- **No consent read path.** Consent can be created and revoked but not listed, so §5.3's
  consent card has nothing to read.
- **No queue.** Nothing in the repository records inbound product requests. §5.4 is a
  screen over a table that does not exist.

---

## 1. Brand system

Unchanged from the original plan, which is sound. Tokens go in
`apps/web/src/styles/tokens.css` and are mirrored into `apps/web/tailwind.config.js`.
No hex is hardcoded anywhere else.

The colour tokens, typography scale, layout, spacing, radii and motion rules from the
original §1.2–§1.4 carry over verbatim, including:

- Decision colours are fixed and never decorative. Mint is ALLOW; it is not an accent.
- Body text 15px, nothing below 12px, tabular figures on every number.
- Inter self-hosted via `@fontsource/inter`. No CDN — the presenting room may be offline.
- Cards flat with a 1px slate-200 border; shadows only on overlays.

**Logo:** if `apps/web/public/abhi-mark.png` is missing at build time, fall back to a navy
rounded square containing a white "A". Do not block on the asset.

---

## 2. Information architecture

### 2.1 Sidebar

As the original §2.1: logo mark, wordmark, `IDENTITY HUB` beneath it, then Dashboard,
Customers, Verification Queue, Employer Onboarding, Compliance, Audit Trail, Settings, and
the role switcher pinned to the bottom. Active item takes a mint 3px left rule and a
navy-700 ground.

Count badges come from the new `GET /dashboard/summary` (§4.4).

### 2.2 Routes — and the subject ID problem

| Route | Screen | § |
|---|---|---|
| `/` | Dashboard | 5.1 |
| `/customers` | Customer directory | 5.2 |
| `/customers/:subjectId` | Customer profile | 5.3 |
| `/customers/new` | First-time KYC stepper | 5.9 |
| `/queue` · `/queue/:requestId` | Verification queue | 5.4 |
| `/onboarding` | Employer bulk onboarding | 5.5 |
| `/compliance` | Compliance actions | 5.6 |
| `/audit` | Audit trail | 5.7 |
| `/settings/policies` | Product policies, read-only | 5.8 |

**The gateway's entire public API is keyed by CNIC, not subject ID**, and there is no
lookup endpoint in either direction. This is a real design decision, not an oversight to
route around:

- **A CNIC must never appear in a URL.** It is the primary identifier of a Pakistani
  citizen; putting it in a path or query string puts it in browser history, referrer
  headers and any log the gateway keeps. Routing `/customers/61101-1234567-8` is the one
  shortcut this build must not take.
- Therefore `/customers/:subjectId` stands, and the new read endpoints in §4.4 are keyed
  by subject ID. That means new service methods on `KycGatewayService` that accept a
  subject ID directly rather than deriving one from a CNIC.
- This makes §4.3 of the original plan ("each is thin — it composes calls the chaincode
  already exposes") optimistic. It is a genuine, if small, service-layer addition.

---

## 3. Cross-cutting components

Build these before any screen. All of §3.1–§3.8 of the original plan carry over. Notes
where the repository changes something:

### 3.1 `<IdentityStatus>`

Four pips, filled to the level reached, labels always visible. Level meanings map exactly
to `REQUIRED_METHODS`:

| Level | Plain label | Methods actually required |
|---|---|---|
| A0 | Claimed | `ASSERTED` |
| A1 | ID checked | `VERISYS`, `DOC_AUTH` |
| A2 | Fingerprint verified | + `BIOMETRIC_1TO1` |
| A3 | Fingerprint + selfie | + `LIVENESS` |

### 3.2 `<DecisionBanner>`

`DecisionOutcome` is `'ALLOW' | 'STEP_UP' | 'FULL_KYC' | 'DENY'`. `DecisionReason` is
`'SUFFICIENT' | 'NO_RECORD' | 'SUSPENDED' | 'SHREDDED' | 'CNIC_EXPIRED' |
'ASSURANCE_LOW' | 'STALE'` — **seven reasons, not the two the original plan lists**. Each
needs plain wording, and several are missing from `strings.ts`:

| Reason | Plain line |
|---|---|
| `SUSPENDED` | This customer is frozen by Compliance. |
| `CNIC_EXPIRED` | This customer's CNIC expired on {date}. They must renew it with NADRA first. |
| `SHREDDED` | This customer's personal details were erased at their request. |
| `STALE` | This customer was confirmed too long ago for what this product requires. |
| `ASSURANCE_LOW` | drives STEP_UP, not DENY |
| `NO_RECORD` | drives FULL_KYC |

`STALE` in particular will appear in the demo — SBL and Merchant Financing cap
confirmation age at 180 days.

### 3.4 `<RoleSwitcher>` — the headers already exist

`services/gateway/src/security.ts:61` reads `X-ABHI-MSP` and `X-ABHI-Role`, defaulting to
`ABHIBankMSP` / `gateway`. The original plan proposed adding `X-ABHI-Role`; it is there.

**The header that governs authority is `X-ABHI-MSP`,** because `COMPLIANCE_MSP` is
`ABHIComplianceMSP` and that is what the Compliance-only writes check. The role switcher
must set both:

| Persona | `X-ABHI-MSP` | `X-ABHI-Role` |
|---|---|---|
| Fatima Khan — Compliance Officer | `ABHIComplianceMSP` | `compliance` |
| Bilal Ahmed — Lending Operations | `ABHILendingMSP` | `lending` |
| Sana Iqbal — Branch Onboarding | `ABHIBankMSP` | `bank` |

Header identity throws when `NODE_ENV=production`, which is correct and should be left
alone. The UI's disabled Freeze button is a convenience; the server-side rejection is the
control, and §5.6 shows it deliberately.

### 3.6 `<GlossaryDrawer>`

`strings.ts` supplies **17 entries**, exceeding the original plan's ten, and its wording
is better aligned to the no-jargon rule ("NADRA record check" rather than "Verisys",
"Sharing only what is needed" rather than "Selective disclosure"). Use the file as-is.
`DECISION_GLOSSARY_TARGET` already maps the five banner states to entries.

### 3.7 `<AttributeDisclosure>`

The 14 plain attribute names in the original §3.7 match
`packages/merkle/src/attributes.ts:15-28` exactly. No change needed. Worth carrying over
`ATTRIBUTE_SENSITIVITY` (`high` / `medium` / `low`) from the same file — the high-sensitivity
attributes are the ones whose absence from the disclosed set does the persuading.

---

## 4. Data and endpoints

### 4.1 What exists — use unchanged

The route list in §0.2. No existing request or response shape may be altered.

### 4.2 Copy that must be added to `strings.ts`

`strings.ts` is finished work for what it covers — glossary, ~30 empty states, 9 error
states, 14 toasts, 9 standing notes — and it is clean against the §9 banned list. The only
occurrences of `ALLOW`, `STEP_UP` and `FULL_KYC` are the `DECISION_GLOSSARY_TARGET` keys,
which are code rather than copy. All three verbatim sentences required by §9 are present
in `NOTES`.

But its header claims every user-facing string lives there, and these are absent:

- The four `IdentityStatus` level labels and their hover meanings (§3.1)
- The four `DecisionBanner` headlines and supporting lines, plus **all seven** plain
  `DecisionReason` lines (§3.2 above)
- The 14 plain attribute names (§3.7)
- Sidebar labels, page titles, table column headers, filter labels, button labels
- Product display names — `EWA` → "Earned Wage Access", `ASA`, `SBL` → "Salary-Backed
  Lending", `MERCHANT_FINANCING` → "Merchant Financing"
- Wizard step labels for §5.5 and §5.9
- Record status chip labels for `ACTIVE | SUSPENDED | SUPERSEDED | SHREDDED` — note the
  ledger's fourth status is `SHREDDED`, and §9 requires it read as "Erased"

Add these to `strings.ts` in its existing style before building the components that
consume them. `NOTES.syntheticData` correctly omits a record count; inject the real count
from `GET /dashboard/summary` rather than restoring the original plan's "1,204".

### 4.3 Rail spend — read path

There is no `/rails/summary`. `<SpendMeter>` reads `GET /metrics` and takes
`metrics.rails`. There is no `POST /rails/reset` either — resetting is `npm run demo:seed`
against a restarted gateway, never a UI action.

The original plan's §4.4 requirement that a CBS lookup must not move the spend counter is
satisfied structurally: `MockRails` is the only thing that increments cost, and the CBS
mock will not touch it. Keep it that way and assert it in a test.

### 4.4 New endpoints required

Larger than the original plan's §4.3 estimate, because five of these have no backing store.

```
GET /subject-id?cnic=            → { subjectId }        // resolve, for search only
GET /customers                   ?q=&status=&level=&employer=&page=&pageSize=&sort=
                                 → { rows[], total, page, pageSize }
GET /customers/:subjectId        → { record, cbsProfile, versionCount, lastActivityAt }
GET /customers/:subjectId/history → version chain, newest first, each with humanSummary
GET /customers/:subjectId/consents → active grants with scope and expiry
GET /dashboard/summary           → counts, spend, reuse rate, needs-attention
GET /queue ?status=&product=     → inbound requests
GET /queue/:requestId            → request + last decision + proofs
GET /audit ?since=&subjectId=&actor=&action=&page=   // global; existing route is per-CNIC
POST /rails/cbs/profile   { subjectId }    → { displayName, employer, designation,
                                               employeeCode, joinedAt, avatarSeed }
POST /rails/cbs/profiles  { subjectIds[] } → bulk form
```

`/queue` and `/audit` need an append-only presentation table the gateway writes to on
every verify, register, update, suspend, reinstate, shred and consent call. **Comment it
as presentation state, not ledger state** — the ledger remains the source of truth and
this is an index over it for the UI. Given the POC has no Postgres running by default, an
in-process append-only array reset by `demo:seed` is sufficient and is one fewer moving
part on demo day.

`/subject-id` exists only so global search can turn a typed CNIC into a subject ID before
navigating. The resolved CNIC never enters the URL.

### 4.5 Seed data — new work, not enrichment

The repository has six personas (`scripts/seed-demo.ts`) and a nine-person workforce
(`scripts/dummy-data.ts`). The directory, the dashboard chart and the triage bar all need
a cohort. Write `scripts/seed-cohort.ts` producing ~1,200 subjects with:

- A plausible Pakistani full name, gender-consistent
- One of six invented employer names, clearly not real companies
- A designation from ABHI's actual customer profile — machine operator, stitcher, security
  guard, driver, packer, line supervisor, helper, quality checker
- An employee code, joining date, and an `avatarSeed` for a generated initials avatar.
  **No photographs, generated or otherwise.**
- A CNIC with a deliberately invalid check digit, so `scripts/check-cnic-literals.mjs`
  stays satisfied and no seeded value can collide with a real citizen's card

Seeded and deterministic: the same cohort on every run, or the rehearsal and the
performance disagree and somebody notices.

The existing six personas must survive as named individuals inside the cohort — the demo
click path in §6.1 depends on them.

### 4.6 A `numbers` script

The original plan repeatedly requires dashboard figures to reconcile with a `make numbers`
that has no equivalent here. Add `npm run numbers` → `scripts/numbers.ts`, printing the
cohort distribution, the modelled costs per level and the aggregate spend and avoidance,
computed from the same `DEFAULT_RAIL_COSTS` the gateway uses. If a figure on screen
disagrees with this script's output, the screen is wrong.

### 4.7 Keeping ledger and core banking distinct

Unchanged and important. Ledger-sourced facts sit in the **Identity** card with a mint
`Ledger` tag; core-banking facts sit in **Customer details** with a slate `Core banking`
tag. `NOTES.ledgerHoldsNoData` sits under the Identity card on every profile, always.

---

## 5. Screens

The original §5.1–§5.9 stand as written, with these corrections.

### 5.1 Dashboard

Four metric cards, the stacked confirmation chart, needs-attention list, recent activity,
and the 30-day spend chart. Follow the `dataviz` skill for chart colours and axes.

**Every figure is computed** — from `GET /dashboard/summary`, itself derived from the
seeded cohort and `DEFAULT_RAIL_COSTS`. The illustrative figures in the original plan are
layout placeholders only, and the money ones are not reachable at all (§0.3). The spend
card carries the modelled-placeholder line.

### 5.3 Customer profile

Four tabs as specified. Two notes:

- The history timeline reads from `GET /customers/:subjectId/history`, which wraps
  `versionChain`. The plain-language `humanSummary` per entry is generated server-side so
  the sentence and the record cannot drift apart.
- The Product access tab is driven by `GET /policies`, filtered to the four customer-facing
  products via a named constant (§0.4).

### 5.4 Verification queue

**This screen has no data source today** (§0.5) and depends entirely on the presentation
table in §4.4. It is the largest piece of new backend work in the build and it is cut
item #5 — decide at the Day 4 gate, not on Saturday night.

### 5.5 Employer onboarding

`POST /employer/bulk-lookup` returns `{ total, activateNow[], needsOnboarding[], denied[],
invalid[], unauthorised[] }` — four buckets plus invalid, keyed by CNIC. The original
plan's three-segment triage bar maps as: activate now → ready, needs onboarding → split by
whether a record exists, denied → blocked. `unauthorised` exists because of the employment
register gate (SEC-05) and should be shown, not silently dropped.

The saved-cost panel is computed from the real cost table. At EMPLOYER_BULK's A2 minimum,
a full journey is PKR 80 per head, so a 1,000-row upload models at PKR 80,000 without
reuse. The panel carries the placeholder caveat.

### 5.6 Compliance

Freeze is `POST /kyc/suspend { cnic, reason, referenceId }` — **`referenceId` is required**
and the original plan omits it. Reinstate takes the same shape. Erasure is
`POST /kyc/shred { cnic, reason, legalBasis }`, not `/kyc/erase`; `legalBasis` is required
and is exactly the field that makes the erasure screen honest.

The unauthorised-write rejection returns `ERR_COMPLIANCE_ONLY` → HTTP 403. Render it as a
designed state with the raw error behind the expander.

### 5.7 Audit trail

Needs the new global `GET /audit`; the existing `/audit/events` is per-CNIC.
`AuditEvent` carries `eventId, subjectId, action, decision, decisionReason, requestedBy,
requestedFor, policyId, attributesDisclosed, occurredAt, txId` — enough for every column
including the "what did this product see" detail.

### 5.9 First-time KYC

The final card reads **`3 checks · PKR 80`** for an A2 journey, or `4 checks · PKR 100` for
A3 — computed, never typed. Timing is measured from the actual run.

---

## 6. Demo thread

The original §6.1 click path, §6.2 presenter aids, §6.3 freeze animation and §6.4 reuse
comparison all stand. The comparison strip's figures come from `VerifyResult`, which
returns `railCallsAvoided` and `costAvoidedPkr` directly — the one place the original plan
asked for a number the API already hands over.

`?demo=1` pre-warms caches and pins the comparison panel open, with no visible demo chrome.

---

## 7. Build order

Re-estimated. The backend gap is larger than the original plan assumed, and the two
estimates below that changed are marked.

### Day 4 — Friday 21 August

| # | Work | Est |
|---|---|---|
| F1 | `apps/web` scaffold, tokens, Tailwind, Inter, logo, app shell, routing, role switcher | 1.5 h |
| F2 | Primitives: `DataTable`, `StatusChip`, `EmptyState`, `LoadingSkeleton`, `ErrorState`, `Toast`, `TechnicalDetail` | 1.5 h |
| F3 | `IdentityStatus`, `DecisionBanner`, `AttributeDisclosure`, `SpendMeter`, `GlossaryDrawer` + the missing copy in §4.2 | 1.5 h |
| F4 | **Backend: new endpoints, CBS mock, cohort generator, `numbers` script** | **3 h** *(was 1.5 h)* |
| F5 | Dashboard | 1 h |

**Gate:** the shell renders from real data, sidebar counts are live, and the dashboard
reads correctly to somebody who has not seen the project. **Decide the cut list here.**

### Day 5 — Saturday 22 August

| # | Work | Est |
|---|---|---|
| F6 | Customer directory | 1 h |
| F7 | Customer profile, four tabs | 2 h |
| F8 | Verification queue + detail + STEP_UP action | **1.5 h** *(was 1 h — the queue store is new)* |
| F9 | Employer onboarding wizard | 1.5 h |
| F10 | Compliance screen, freeze animation, rejection panel | 1 h |

Day 4 is now ~8.5 h against a ~7 h window. F4 is the overrun risk and it is upstream of
everything, so start it first if Friday looks tight — or take cut #5 (queue) at the gate,
which removes about 1.5 h of F4 and all of F8.

---

## 8. Cut list

Unchanged from the original, and still correct. Cut from the top, at the Day 4 gate:
Settings → Audit trail → dashboard charts → first-time KYC stepper → verification queue →
product access tab.

**Never cut:** the customer profile with identity history; the reuse comparison strip; the
freeze animation and the unauthorised-write rejection; employer bulk onboarding; and the
plain-language copy everywhere.

---

## 9. Copy rules

Unchanged. The banned list applies absolutely, `strings.ts` is the single source, and the
three verbatim sentences must appear. Add `SHREDDED` → "Erased" to the preferred-phrasing
table, and note that "Crypto-shred" is the repository's internal term and must never
surface.

---

## 10. Acceptance checks

The original §10 list stands, with these substitutions:

- `npm run verify` passes unchanged after this work — replaces the Build Guide Step 24
  `curl` gate, which does not exist.
- `npm run demo:seed` returns the UI to an identical starting state, twice in a row —
  replaces `make reset`.
- Every displayed money figure reconciles with `npm run numbers` — replaces
  "reconciles with `make numbers`".
- No CNIC appears in any URL, browser history entry or client-side log.
- A CBS profile lookup does not move the spend counter *(assert in a test)*.
- A freeze attempted as `ABHILendingMSP` is rejected by the gateway with 403, not merely
  hidden by the UI.
- No screen implies the ledger removes CDD, e-CIB or AML screening. `NOTES.reuseScope`
  appears beside every reuse result.
- Money figures carry the modelled-placeholder caveat.

---

## 11. Open items

1. **`[OPEN-3]` — real rail unit costs.** Finance has not supplied them. Until then every
   figure on screen is a model, and the UI says so.
2. **POC Plan §5.4 is stale** on SBL and Merchant Financing assurance levels. Correct it
   before Monday; both documents may be read in the room.
3. **`effectiveFrom: 2026-09-01`** post-dates the presentation. Decide whether to show the
   pending-approval state deliberately or move the date. Do not hide it.
4. **The Fabric network has still never been started** — Docker was unavailable on the
   build machine. `GET /metrics` returns `ledgerMode`, and the UI should reflect the
   simulator honestly rather than implying a live network.
5. **`apps/console` retirement.** Keep it until `apps/web` is demo-ready; delete it only
   after the Day 5 rehearsal passes.
