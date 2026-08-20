# POC Presentation Plan
## ABHI Unified KYC Ledger & Agentic Orchestrator

**Audience:** Executive sponsor, Compliance, Risk, Product, Engineering
**Duration:** 30 minutes — 18 demo, 12 discussion
**Prepared:** 20 August 2026

---

## 0. Read this first

This plan assumes you will be asked hard questions by people whose job is to
find the hole in it. The fastest way to lose a Compliance audience is to be
caught overstating something small; the fastest way to win one is to name your
own limitations before they do.

**Three sentences you should be willing to say out loud:**

1. "The ledger holds proof, not data — no CNIC and no attribute value ever
   reaches it, and there is a test that fails the build if one does."
2. "This runs on a simulator, not a Fabric network. It proves the domain logic
   and proves nothing about multi-org governance."
3. "Every rupee figure on screen is modelled. Finance has not signed the unit
   costs."

If you only remember one thing: **the demo's job is to make one number
believable** — that an A2 customer applying for a Salary-Backed Loan runs
**one** check instead of four.

---

## 1. The one-sentence pitch

> ABHI verifies the same customer's identity separately for every product.
> This puts one cryptographic record of each verification on a permissioned
> ledger, so the second product reuses the first product's work instead of
> paying for it again — without any product ever seeing the customer's data.

---

## 2. The spine of the demo

Everything below is a real screen driven against a running gateway with a
seeded cohort of 1,204 synthetic customers. Nothing is a slide of a screenshot.

| # | Minutes | Screen | The point being made |
|---|---|---|---|
| 1 | 0–2 | Dashboard | What the system is, in ten seconds |
| 2 | 2–5 | Customer profile | Ledger truth vs. bank records, side by side |
| 3 | 5–10 | **A2 customer applies for SBL** | **The headline. One selfie, not four checks.** |
| 4 | 10–13 | Selective disclosure | The product saw 4 of 14 attributes |
| 5 | 13–15 | Compliance freeze | Authority is split and enforced by the ledger |
| 6 | 15–18 | Audit trail | What an SBP inspector would be handed |

---

## 3. Scene by scene

### Scene 1 · The dashboard (2 min)

**Open on:** `/`

**Say:** "1,204 customers. 847 have a confirmed identity. Seven checks were
reused today, and that avoided PKR 600 of external spend."

**Point at:** the *Verification activity* chart — seven days of real
verification volume, today emphasised.

**The line that matters:** "The reuse figure is the whole business case. Every
one of those is a check ABHI would otherwise have paid NADRA for a second
time."

> **Say the caveat here, early:** "The money is modelled. Those unit costs are
> placeholder grid points waiting on Finance — the ratio is the claim, not the
> rupees." The screen says so itself, under the cards.

---

### Scene 2 · A customer profile (3 min)

**Open on:** any customer from the directory.

**Show the two cards side by side.** The Identity card is ledger truth and
carries a mint *Ledger* tag. The Customer details card is core banking.

**Say:** "These are deliberately different colours because they are different
systems. The ledger knows this person's identity was confirmed to level A2 on
this date. It does not know their name. Their name comes from core banking."

**Point at:** the masked CNIC — `42201-*****-6`. "The full number is never in
this console, never in a URL, and never in the ledger."

---

### Scene 3 · The headline — A2 customer applies for SBL (5 min)

> **This is the scene. If you are running short, cut everything else.**

**Set up:** find an **A2** customer. Open their profile.

**Say:** "This customer opened a wallet with us. We ran a NADRA match, a CNIC
document check and a fingerprint. That is three paid external calls. Today they
want a salary-backed loan, which needs our highest confirmation level."

**Do:** click **Run verification** → choose **Salary-Backed Lending** → *Run
the check*.

**The screen answers:** one screen — *Live selfie verification*.

**Say, slowly:**
> "Today, this customer repeats the entire onboarding pack to borrow against a
> salary we already pay them. The system just said: we already have your NADRA
> match, your CNIC check and your fingerprint. One more step.
>
> **One selfie instead of four checks.**"

**Point at:** the green notice naming exactly what was skipped.

**Then:** complete the selfie and land on the SBL review screen.

**Then:** go back to the profile and click **Update identity** → *Salary-Backed
Lending* → reason → *Run the missing checks*. The record goes **A2 → A3**, and
the version chain gains **v2**.

**Say:** "The old version is not edited. It is superseded and still there,
hash-linked. That is what makes this auditable."

---

### Scene 4 · Selective disclosure (3 min)

**Open on:** the queue, an ALLOW row.

**Point at:** *What this product was shown* — 4 attributes proven, 10 marked
*Not disclosed*.

**Say:** "The lender received a cryptographic proof that this customer's
fingerprint matched, and that their CNIC is in date. It did not receive their
name, their address, their date of birth or their source of funds. It cannot —
the proof only covers what was disclosed."

**Anticipate:** *"How do we know the proof is real?"* → "Every proof is
verified against the root the ledger holds, twice, before it is returned. A
proof that fails either check is refused rather than returned."

---

### Scene 5 · Compliance authority (2 min)

**Do:** as a Lending persona, try to **Freeze** a customer. The button is
disabled.

**Say:** "That is a courtesy. The real control is the chaincode — if Lending
sent that transaction directly, the ledger would reject it."

**Do:** switch persona to Compliance via the avatar. Freeze the customer with a
reason and case reference.

**Do:** go to any product and check that customer → **DENY**.

**Say:** "No integration. No batch job. The freeze is effective for every
product the moment it is written."

---

### Scene 6 · The audit trail (3 min)

**Open on:** `/audit`.

**Say:** "This is the record an SBP inspector would be given. Every decision,
who asked, which policy version was in force, and what was disclosed."

**Point at:** the version chain on a customer's *Identity history* tab.

**Say:** "Each version hashes the one before it, as stored. A DBA editing a
historical record directly breaks the chain, and we have a test that proves the
break is detected."

---

## 4. The questions you will be asked

Prepared answers. Say the honest one.

| Question | Answer |
|---|---|
| **"Is this on a real blockchain?"** | No. It runs on an in-memory simulator of the chaincode. The chaincode itself is real and tested — 47 tests — and the network definition exists. Fabric deployment is Sprint 4, blocked only on Docker availability. **The simulator proves the domain logic and proves nothing about endorsement or multi-org governance.** |
| **"Are those real customers?"** | No. 1,204 synthetic records. The console carries a permanent DEMO DATA badge for exactly this reason. |
| **"Are the savings real?"** | The *ratio* is real — it falls out of the policy table. The *rupees* are modelled. Finance has not signed the unit costs ([OPEN-3]). |
| **"Does this replace our credit checks?"** | **No, and this is the most important answer in the deck.** e-CIB runs on every origination regardless of identity assurance. There are five tests whose only job is to prove reuse never displaces the credit check. |
| **"What about the customer who has never been verified?"** | They get the full Asaan Digital Account journey. Roughly one request in seven is a new applicant — the system does not pretend otherwise. |
| **"Can a product see data it shouldn't?"** | Disclosure is the three-way intersection of what was requested, what the customer consented to, and what the product's policy permits. The narrowest always wins. |
| **"What if a customer asks to be forgotten?"** | Crypto-shredding: the encryption key is destroyed, which makes every backup copy of the ciphertext undecryptable. The proof that a verification happened survives, because that is an audit fact, not personal data. |
| **"Who signed off these policies?"** | **Nobody yet.** They are engineering defaults from the Product Manual. Compliance sign-off is a Phase 1 exit gate, and the system refuses to evaluate an unapproved policy in production. |
| **"Is it secure?"** | Header-based identity today; mTLS and OAuth2 are Sprint 9. The gateway refuses to start in production without them. Do not let anyone leave thinking this is production-hardened. |

---

## 5. What is NOT built — say this before you are asked

Put this on a slide. It buys more credibility than any demo moment.

| Gap | Status | When |
|---|---|---|
| Hardware HSM (PKCS#11) | Port written, software stand-in in use | Sprint 8 |
| Fabric network deployment | Chaincode ready, Docker unavailable here | Sprint 4 |
| mTLS / OAuth2 | Header identity; refuses to boot in prod | Sprint 9 |
| Real NADRA / e-CIB / CBS | Cost-instrumented mocks | Sprints 4–6 — **contracting must start now** |
| Migration of the existing base | Not started | Sprints 13–14, blocked on [OPEN-5] |
| PostgreSQL vault driver | Schema written, in-memory store in use | Sprint 2 |

**The two things to escalate in the room:**

1. **NADRA contracting is the long pole and it is commercial, not technical.**
   It must start at S0, not S4. Engineering cannot unblock it.
2. **[OPEN-5] — what assurance level do existing customers get?** This is a
   Compliance decision with direct commercial consequence. Assign too high and
   the bank grants reliance it cannot evidence; too low and the platform
   launches with a base that all needs re-verifying, which destroys the value
   proposition on day one.

---

## 6. Running it

```bash
npm run gateway:dev
```

```bash
npm run dev --workspace @abhi/web
```

The gateway seeds 1,204 customers and 64 requests on boot. Verify everything
passes before you present:

```bash
npm run verify
```

```bash
npm run test:web
```

**Rehearsal checklist**

- [ ] `npm run verify` green (typecheck, CNIC gate, vectors, 268 tests, conformance)
- [ ] `npm run test:web` green (55 tests)
- [ ] Restart the gateway immediately before presenting — the demo mutates state
- [ ] Identify your A2 customer for Scene 3 **in advance** and keep the URL open
- [ ] Check the projector: the palette is calibrated for one, but confirm the
      mint reads as green and not grey from the back of the room
- [ ] Have `docs/GAP_ANALYSIS.md` open in a tab for the questions in §4

---

## 7. Fallbacks

| If this breaks | Do this |
|---|---|
| Gateway will not start | `apps/console/index.html` is a zero-dependency fallback console |
| A screen errors mid-demo | Every route is addressable — type the URL and carry on |
| Someone disputes a number | `npm run numbers` reconciles every figure on the dashboard |
| Asked to prove the crypto | `npm run vectors:verify` — 7 pinned reference vectors |
| Asked to prove no PII on ledger | `npm test` and point at C-07 |

---

## 8. The close

> "What you have seen is the domain logic, working, with the cryptography
> tested and the limitations on the screen rather than in a footnote. What it
> is not yet is a deployed system — no Fabric network, no HSM, no real NADRA.
>
> The next sprint converts the central claim from argued to demonstrated: put
> the chaincode on a real three-org network and show that a single organisation
> cannot write a record alone. That is one sprint, and it is the one that
> matters.
>
> The decision I need today is not technical. It is whether Compliance will
> own [OPEN-5], and whether we can start NADRA contracting this month."
