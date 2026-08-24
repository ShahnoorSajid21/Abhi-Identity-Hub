# The ABHI Unified KYC Ledger — Explained Simply

*For business, product and compliance readers. No technical background assumed.*

---

## 1. What This System Is

**KYC** — "Know Your Customer" — is the set of checks confirming a person is who they say they are. In Pakistan that means checking the CNIC against NADRA, confirming the card is genuine, matching a fingerprint, and sometimes taking a live selfie.

**The problem.** ABHI verifies the same person repeatedly: once for the wallet, again for earned-wage access, again for a salary-backed loan. Each check costs money, takes the customer's time, and produces a result nothing else can reuse. Worse, ABHI cannot tell a CNIC biometrically verified at a NADRA counter from a CNIC an employer typed into a spreadsheet. In today's records they look identical.

**The main idea.** Verify once. Record *proof* that the verification happened — never the customer's data — in a shared register no single team can quietly change. Every other product reads that proof and decides, under its own rules, whether it is good enough.

**An analogy.** Today every counter in the building demands your passport and re-runs the whole interview. This is closer to airport security issuing a wristband: the interview happens once, and later counters check the wristband is genuine, unexpired and not revoked — but each counter still applies its own rules.

**What "reusability" means.** Not "the check is skipped forever", but that a later product relies on work already done and pays only for what is genuinely missing. Section 6 sets out the conditions.

---

## 2. System Architecture — Big Picture

```text
   CUSTOMER  (or an employer uploading a staff list)
        |
   DASHBOARD — operations, compliance and product screens
        |
   GATEWAY — runs the checks · applies each product's policy ·
             builds the sealed summary · assembles disclosures
        |                                  |
   SECURE VAULT                       LEDGER (blockchain)
   encrypted personal data            proof only, no data
   never on the ledger                built-in rules decide
                                      what may be written
                                           |
                              REUSE / VERIFICATION
                              ALLOW · STEP-UP · FULL KYC · DENY
                                           |
              EWA · ASA · Salary-Backed Loan · Merchant Financing
              · Employer Portal · Read-only partners
```

| Component | What it does |
|---|---|
| **Dashboard** | Where staff see customers, decisions and history. Never shows a full CNIC |
| **Gateway** | The working core: runs the checks, applies policy, issues the decision. Judgement lives here because product rules change often |
| **Secure vault** | The encrypted store of the customer's real details — deliberately outside the ledger, so data can genuinely be destroyed when the law requires it |
| **Ledger** | The shared register of verification facts: that a check happened, how strong it was, what state the record is in. Never a name, CNIC or address |
| **Rules built into the ledger** | A *smart contract* is a fixed set of rules stored with the ledger deciding which writes are allowed. Here: only Compliance may freeze a customer, and records are never edited in place |
| **Other products** | Each asks the ledger, and each has its own required strength and freshness |

---

## 3. End-to-End Flow — Step 1 to Final Step

### Step 1 — Customer starts KYC

A customer applies for a product, or an employer uploads staff CNICs. Fourteen attributes are collected: name, parent's name, date of birth, address, CNIC number and expiry, profession, purpose of account, source of funds, tax status, and the outcome of each check.

### Step 2 — Information reaches the gateway

The screens decide nothing. Everything goes to the gateway — the only component allowed to talk to the vault, the identity providers and the ledger. One place to audit; one place where rules are enforced.

### Step 3 — KYC verification

The gateway runs the checks that product requires. Each one that passes raises the assurance level:

| Level | What was actually done |
|---|---|
| **A0** | Someone *asserted* the identity — typically an employer typing a CNIC. Nothing checked |
| **A1** | NADRA record match plus a document authenticity check |
| **A2** | The above, plus a fingerprint match |
| **A3** | The above, plus a live selfie check |

The level is **derived from what actually passed**. It cannot be claimed, and a failed check cannot inflate the record.

**POC simulation:** NADRA and the liveness provider are **not connected**. Their responses come from mock services with realistic costs and attempt limits. The credit-bureau (e-CIB) check is likewise simulated.

**Not in this POC at all:** AML and sanctions screening. Out of scope, and not replaced by this system.

### Step 4 — The KYC record is created

The **personal details** go into the encrypted vault, each paired with a secret random value that prevents guessing. The **sealed summary** is a short code — about 32 bytes — derived from all fourteen attributes together: change any one and the code changes completely, and it cannot be run backwards to recover anything.

The **ledger identifier** is not the CNIC, but a code derived from it using a secret key inside a tamper-resistant device that never reveals the key. Without that key it cannot be traced back to a citizen.

### Step 5 — The blockchain record is created

Written to the ledger: the identifier, the sealed summary, the assurance level, which checks ran, the status, the verification and expiry dates, the CNIC expiry, and the originating product.

Never written: any name, CNIC, address, date of birth, document, fingerprint or selfie. An automatic check inspects every payload before it reaches the ledger and rejects anything CNIC-shaped; a test then asserts the whole ledger stays clean, so a regression fails the build.

### Step 6 — The blockchain confirms the record

The ledger is held by three separate ABHI organisations — Bank, Lending and Compliance — so none controls it alone. Every version carries a fingerprint of the version before it, so altering a past entry breaks every later link and makes the tampering visible.

**POC simulation:** that multi-organisation network is **fully defined but has never been started**. Today the POC runs a *simulator* with the same rules, record states and chaining, but no independent organisations and no multi-party approval. It proves the logic; it proves nothing about governance. The software refuses to run this way in production.

### Step 7 — The KYC becomes reusable

The record now sits under one identifier every product can ask about. The ledger returns facts — level, checks, status, dates — and the gateway compares them against that product's policy: minimum strength, maximum age, and whether an expired CNIC is a hard stop.

### Step 8 — Another product requests KYC

```text
Product asks about the customer
        |
Gateway reads the ledger record
        |
Record checked against that product's policy
        |
Decision: ALLOW / STEP-UP / FULL KYC / DENY
        |
Product continues, or runs only what is missing
```

- **ALLOW** — the record satisfies this product. **No identity checks run at all.**
- **STEP-UP** — a record exists but falls short. The system names the missing checks. Only those run.
- **FULL KYC** — no usable record exists. The complete journey runs.
- **DENY** — the customer is frozen, or the CNIC has expired. Re-checking fixes neither.

### Step 9 — The result is returned

The product receives the decision, the reason, the current level, the age of the verification and the missing checks. Two things happen regardless of the answer.

**The credit check still runs.** e-CIB checks credit standing, not identity. It runs at every origination, is never displaced by reuse, and its answer returns to the product but stays out of the identity decision — a credit problem is not a KYC problem.

**Disclosure stays minimal.** With consent, a product can receive *proof* of a few named attributes — that the NADRA and fingerprint matches passed, say — and check independently that they belong to the sealed summary on the ledger, without receiving anything else. In the walkthrough this releases 4 of 14 attributes and leaks none of the other 10. A product gets the narrowest of three limits: what it asked for, what the customer consented to, what its policy permits.

### Step 10 — Audit, corrections and traceability

Every event is recorded on the ledger — registration, verification, update, freeze, release, consent, proof issued, erasure — with who asked, for which product, under which policy version, and which attribute *names* were disclosed, never their values. Anyone can confirm the fingerprint chain is intact from a ledger export alone; an inspector does not have to trust ABHI's systems to verify ABHI's history.

Three lifecycle events matter to the business:

- **Update** — a renewal or re-check appends a *new version*; the old is superseded, never edited. Every product resolves to the latest on its next call.
- **Freeze** — one Compliance action stops the customer at every product immediately. Product teams cannot do this.
- **Erasure** — the encrypted data is destroyed and the ledger records that it happened. The data is gone, the audit fact remains, and the customer may re-onboard.

**Final business outcome:** later products get a trustworthy identity answer in one step, paying only for work genuinely missing, while Compliance keeps a tamper-evident history of every decision.

---

## 4. How the Blockchain Actually Works

> Blockchain is being used here as a trusted record of important KYC events.

**A. KYC information is processed.** Checks run, and the gateway determines what actually passed — and therefore how strong the evidence is.

**B. A blockchain record is created.** It holds the untraceable identifier, the sealed summary, the level, the checks, the status and the dates. No personal information.

**C. The record is added to the ledger.** Adding is the only permitted operation — no edit, no delete. A correction is a new version superseding the old, and both stay visible.

**D. The record becomes difficult to change silently.** Each version fingerprints the one before, so altering the past breaks every later link. Several organisations must also agree before a change is accepted, so no one team can rewrite history alone.

**E. Future systems can verify the record.** Another product asks the ledger directly, and given a limited disclosure can confirm mathematically that those attributes match the ledger's summary — without contacting whoever collected them.

### The important rule

> **Blockchain helps preserve and verify the integrity of the recorded information. It does not make the original customer information true.**

If a check was wrong, or an employer asserted something false, the ledger faithfully preserves that wrong answer — which is why it records the *strength* of every verification. An unverified assertion is stored as A0, visibly not the same thing as a biometrically matched A2. The ledger makes the difference impossible to hide; it does not make the assertion true.

---

## 5. What Goes On Blockchain vs Off Blockchain

| Information | Where it is stored | Why |
|---|---|---|
| Name, address, date of birth, parent's name | Encrypted vault only | Privacy — and it must be destroyable on request |
| CNIC number | **Nowhere.** Converted to an untraceable identifier, then discarded | A citizen's primary identifier is the riskiest thing to keep |
| Untraceable customer identifier | Blockchain | Products can refer to a customer without exposing who they are |
| Sealed summary of the 14 attributes | Blockchain | Proves nothing was altered, while revealing nothing |
| Assurance level, checks run, status, key dates | Blockchain | The reusable facts other products need, and what a freeze acts on |
| Link to the previous version | Blockchain | Makes silent alteration detectable |
| Consent records and KYC events | Blockchain | Provable record of what was allowed and what was disclosed |
| Secret values protecting each attribute | Encrypted vault only | Destroying them is what makes erasure real |
| Documents, fingerprints, selfies | **Not handled at all** — only the pass/fail outcome is kept | Out of scope for this POC |
| Name and employer shown on screen | Simulated core-banking service *(POC simulation)* | Display only — never reaches the ledger |
| Credit-bureau result | Returned to the product, not written to the ledger | Credit standing changes constantly; identity proof does not |

---

## 6. How KYC Reusability Works

```text
TRADITIONAL                        PROPOSED
Customer -> Product A -> Full KYC  Customer -> KYC performed once
Customer -> Product B -> Full KYC             -> Trusted KYC record
Customer -> Product C -> Full KYC             -> Reusable verification
                                                 |-- Product A  (ALLOW)
                                                 |-- Product B  (STEP-UP)
                                                 |-- Product C  (FULL KYC / DENY)
```

**What reuse means, and why it saves work.** A later product relies on identity work already completed, so where the record satisfies it, no identity checks run. The expensive parts are the external calls and the customer's time.

**How validity is checked.** Every request re-evaluates the live record against that product's rules: strength, age, CNIC validity, freeze status, consent. Nothing is cached, nothing assumed.

**If the KYC changed or lapsed.** A change appends a new version, picked up by every product on its next request. A frozen customer is denied everywhere immediately. An expired CNIC is a hard stop, never a step-up. A record past a product's age limit needs re-affirmation. An erased record returns to full onboarding.

**Does the POC implement these?** Yes — all four decisions, versioning, freeze and release, consent and withdrawal, limited disclosure and erasure run end to end, under test. What is *simulated* is the outside world: the network, the identity providers, the credit bureau, the security device and the production database.

**An important caution.** Reuse is never unconditional. It remains subject to bank policy, regulation, freshness rules, consent and any required re-verification. Full due diligence still applies — what this removes is the *re-collection* of what ABHI already verified. It does not remove AML or sanctions screening, does not remove the credit check, and does not replace NADRA as the source of truth.

---

## 7. A Simple Real-World Example

**Ali Khan** opens an ABHI wallet and completes the full journey: CNIC checked against NADRA, card confirmed genuine, fingerprint matched. He reaches A2. His details are encrypted in the vault; the sealed summary, level, checks and dates go to the ledger under an identifier that cannot be traced back to his CNIC.

Two months later he requests earned-wage access, which needs A2 and a verification under a year old. The record is active, strong enough and recent, so the answer is **ALLOW** — **no identity checks run**. His credit check still runs, as always.

Later he applies for a salary-backed loan, which needs A3. The system answers **STEP-UP** and names what is missing: the live selfie. Ali takes one selfie; everything else is reused, and every other product sees the new version immediately. Today, that third application would repeat the entire onboarding pack.

---

## 8. Why Blockchain Instead of a Normal Database?

| Normal database | Blockchain ledger |
|---|---|
| Controlled by one system owner | Shared by several organisations |
| An authorised administrator can change a record | Records cannot be edited — only superseded, visibly |
| History needs extra machinery to preserve | The history *is* the structure |
| Other parties must trust the owner's word | Other parties can verify for themselves |
| One team could mark a customer verified | Compliance must co-approve every identity status change |

**Do not oversell this.** A normal database is the better answer when one organisation owns the system end to end, when very high volumes matter more than shared trust, when no external party needs to verify anything, or when a ledger adds cost without adding business value.

**Why it earns its place here.** First, no single team can declare a customer verified: Compliance must co-approve every identity status change. Second, the history holds up to outside scrutiny — a regulator can verify it from an export. Third, the State Bank has advised banks to join the Pakistan Banks' Association shared e-KYC platform, which requires one canonical KYC record per customer; ABHI does not have one, and this is that record. The first point is what the architecture rests on — and, as Step 6 notes, the one thing this POC has not yet proven.

---

## 9. Business Value

- **Verify once, not repeatedly**, paying only for what is missing — where a record satisfies a product, no external identity calls are made.
- **Faster onboarding and a better customer experience** — one missing check replaces a full onboarding pack, and customers stop re-supplying evidence they already gave.
- **Visible quality of evidence** — an assertion can no longer be mistaken for a verified identity.
- **Instant compliance action** — one freeze stops a customer everywhere.
- **Stronger traceability** — a complete, tamper-evident history of every decision.
- **A foundation for shared KYC** — the canonical record a national platform would require.

**On the money, honestly.** The system measures the cost it avoids, but the unit costs are placeholders Finance has not signed off, and the rate at which ABHI actually duplicates verifications has never been measured — that needs historical data this build does not have, and that number, not any demo figure, should decide whether a production programme is funded. A second question is open: whether one biometric step in the product manual is due diligence (reusable) or per-transaction authorisation (not reusable). If the latter, part of what the demo counts as avoided cost would be spent anyway and the savings figure is overstated. Neither can be settled without Compliance.

---

## 10. What Problem This POC Is Solving

```text
CURRENT PROBLEM                      PROPOSED SOLUTION
Repeated KYC across products         KYC performed once
     |                                    |
Duplicate cost and effort            Trusted, versioned KYC record
     |                                    |
Slower onboarding                    Reusable verification, per-product rules
     |                                    |
Poor customer experience, and no     Faster onboarding, provable history,
way to tell a verified identity      one place to freeze a customer
from an asserted one
```

**The system gap.** ABHI has no authoritative answer to "how well do we know this customer, and how do we know that?" — so every product re-asks from scratch, and an unchecked assertion is indistinguishable from a verified identity. This POC closes that gap with one canonical record per customer — reusable, versioned and revocable — while keeping every byte of personal data off the shared ledger.

**Proven:** the decision logic, record structure, version chaining, privacy design and reuse behaviour all work end to end, under test.

**Not proven:** the multi-organisation governance that makes "no single team can do this alone" true rather than merely designed. That remains the top priority.
