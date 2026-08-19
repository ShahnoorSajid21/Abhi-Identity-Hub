# Compliance Audit Report
## ABHI Unified KYC Ledger — POC Implementation

| | |
|---|---|
| **Scope** | Implementation as built, against SBP and Pakistani banking instruments |
| **Method** | Control-by-control review with executable evidence where a control is testable |
| **Date** | 17 August 2026 |
| **Verdict** | **PASS for POC scope.** Two blocking items require Compliance decisions before production; neither is an engineering gap |

> **Method note.** This report maps controls at **instrument level** and does not cite clause numbers. Clause-level interpretation carries regulatory consequence and is a Compliance action, not an engineering one. Where an interpretation is required it is named as an owned action rather than asserted.

---

## 1. Control matrix — implementation evidence

| ID | Control | Instrument family | Status | Evidence in code |
|---|---|---|---|---|
| **C-01** | No unilateral KYC status change | AML/CFT governance | **IMPLEMENTED** | Endorsement `AND(Compliance, OR(Bank, Lending))` in `deploy-chaincode.sh`; in-chaincode MSP guard; 4 negative tests |
| **C-02** | Complete tamper-evident verification history | Record keeping | **IMPLEMENTED** | `getVersionChain` with `chainValid` / `brokenAt`; tamper test proves detection |
| **C-03** | Verification strength recorded per customer | CDD | **IMPLEMENTED** | `assuranceLevel` + `methods`, consistency-enforced at write |
| **C-04** | Instant cross-product freeze | AML/CFT | **IMPLEMENTED** | `suspendKYC`; E2E-4 proves all four products deny on the next call |
| **C-05** | Consent recorded before disclosure | e-KYC / data protection | **IMPLEMENTED** | `recordConsent`; `generateProof` refuses without an active, unexpired consent |
| **C-06** | Least disclosure | Data protection | **IMPLEMENTED** | Three-way intersection; `attributesDisclosed` recorded per issuance |
| **C-07** | No PII on the ledger | Data protection | **IMPLEMENTED** | Design principle P1 + `assertNoPII` tripwire; full state export asserted clean |
| **C-08** | Erasure capability | PDPB (anticipated) | **IMPLEMENTED** | `markShredded` + `vault.crypto_shred()`; E2E-7 proves root survives, data does not |
| **C-09** | Screening not displaced | AML/CFT | **IMPLEMENTED** | `MockECib` modelled separately and **never** avoided by reuse; asserted in E2E-2 |
| **C-10** | Expired CNIC blocks reliance | CDD | **IMPLEMENTED** | Hard `DENY`, never `STEP_UP`; asserted in the decision-table suite |
| **C-11** | Policy changes require dual approval | Governance | **PARTIAL** | `ProductPolicy.approvedBy` field exists and is populated `PENDING:*`; no approval **workflow** is implemented |
| **C-12** | Key custody under split knowledge | Operational risk | **DEFERRED** | Software HSM in POC; see SEC-01 |

---

## 2. Instrument-by-instrument

### 2.1 SBP BPRD Circular Letter No. 22 of 2023 — Shared e-KYC Platform

| | |
|---|---|
| **Requirement in substance** | Join the PBA shared e-KYC platform; DLT-based; data held at the banks; access gated on explicit consent |
| **As built** | Structural match on all three counts. DLT: Fabric, 3 MSPs, real endorsement. Bank-held data: the vault never leaves ABHI. Consent-gated: `ConsentRecord` with scope, purpose, expiry and evidence reference, enforced before any disclosure |
| **Gap** | Consonance schema mapping not started; membership terms unknown **[OPEN-2]** |
| **Action** | Phase 3. Keep the interop projection separate from the canonical record |

### 2.2 SBP BPRD Circular No. 01 of 2025 — Consolidated Customer Onboarding Framework

| | |
|---|---|
| **As built** | The assurance ladder A0–A3 makes verification strength explicit, machine-readable and enforced. `packages/policy/src/policies.ts` carries per-product minimum assurance and maximum age |
| **Gap — BLOCKING** | **The A0–A3 ↔ SBP account-category mapping does not exist [OPEN-A].** Until Compliance provides it, the ladder is an internal risk construct, not a regulatory one |
| **Mitigation in code** | Every policy carries `approvedBy: ['PENDING:Compliance', 'PENDING:ProductOwner']`. The literal string `PENDING` is asserted by the conformance audit (C-03), so the POC cannot quietly present these as approved policy |
| **Action** | **Compliance-owned mapping document. Phase 1 exit gate.** No production use before sign-off |

### 2.3 SBP AML/CFT/CPF Regulations

| | |
|---|---|
| **As built** | **No obligation is altered.** The implementation evidences that CDD was discharged, to what standard, by whom and when, in tamper-evident form. e-CIB runs at every origination and is architecturally incapable of being skipped by reuse |
| **Explicitly out of scope and staying out** | Sanctions and PEP screening. These are point-in-time checks against changing lists; a verification from last year says nothing about today's list |
| **Gap** | `maxAgeDays` values are engineering defaults. They must be set to satisfy ongoing-due-diligence periodicity by risk rating, which is a Compliance parameter |
| **Action** | **[OPEN-B]** — confirm that re-affirming only the strongest method is acceptable as periodic CDD refresh. If it is not, the staleness saving disappears and only the cross-product saving remains |

### 2.4 Prudential Regulations for Microfinance Banks

Unchanged — exposure limits are a credit control, not an identity control. **Secondary benefit worth flagging to Risk:** a reliable `subjectId` improves exposure aggregation, because the same person under two records is exactly how limits get breached accidentally.

### 2.5 Banking Companies Ordinance 1962 · Payment Systems and EFT Act 2007

| | |
|---|---|
| **As built** | Confidentiality strengthened: no PII on-chain, envelope-encrypted vault with no human read path, disclosure limited to policy-named attributes and audited per issuance |
| **Gap** | Intra-group disclosure (Bank → Lending) must be confirmed permissible under current customer terms |
| **Action** | **[OPEN-C]** — Legal. Likely yes within one legal entity, but it must be confirmed and the privacy notice updated to describe reuse |

### 2.6 Personal Data Protection Bill 2023 (not enacted as at Aug 2026)

| Right | As built |
|---|---|
| **Erasure** | Crypto-shredding: ciphertext, DEK and salts destroyed; the root becomes 32 unlinkable bytes. **Critically, this also renders every backup copy permanently undecryptable without touching the backups** — which is where most erasure implementations quietly fail |
| **Localization** | No offshore dependency; all components deployable in-country |
| **Breach notification** | `AuditEvent.attributesDisclosed` identifies precisely which attributes went to which organization and when — exactly what a 72-hour notification requires |

**Gap.** Whether crypto-shredding satisfies a statutory erasure right in Pakistan **is a legal opinion nobody has given** **[OPEN-E]**. The engineering position is that this is the best available structure. Presenting it as a settled answer to a right that does not yet exist in enacted law would be an overclaim.

### 2.7 The erasure / retention tension

The implementation does not dissolve the conflict; it narrows it as far as engineering can. After shredding, what survives on-ledger is: a verification of a stated assurance level occurred on a stated date, performed by a stated organization. No attribute values. No identifier resolvable to a person. E2E-7 asserts all of this.

Whether that satisfies retention **and** erasure simultaneously is a legal question. **[OPEN-E]** must be answered before production, not after.

---

## 3. Gaps requiring a Compliance decision

| # | Item | Owner | Blocking? |
|---|---|---|---|
| **1** | **[OPEN-A]** A0–A3 ↔ SBP account-category mapping | Compliance | **Yes — production** |
| **2** | **[OPEN-B]** Strongest-method re-affirmation as CDD refresh | Compliance | Yes — affects the savings case |
| **3** | **[OPEN-C]** Intra-group disclosure basis | Legal | Yes — pilot |
| **4** | **[OPEN-D]** Employer portal disclosure limits (SEC-05) | Product + Legal | Yes — employer portal |
| **5** | **[OPEN-E]** Legal opinion on crypto-shredding | External counsel | Yes — production |
| **6** | **[OPEN-4]** Compliance capacity to co-endorse every write | Compliance head | **Yes — the architecture depends on it** |
| **7** | C-11 policy approval workflow | Compliance + Eng | No — production hardening |

---

## 4. Recommendation

**The implementation is compliant with everything engineering can be compliant with, and no further.**

Every control that can be built in code is built and tested. What remains is a set of interpretations and approvals that belong to Compliance and Legal — and the codebase is deliberately constructed so those gaps are *visible* rather than papered over: policies carry `PENDING:` approvers, the conformance audit asserts that string is present, and the POC therefore cannot present unapproved policy as approved.

**The single most important compliance item is [OPEN-4].** If Compliance cannot resource co-endorsement of every KYC status change, the endorsement policy becomes decoration and the central architectural claim of this programme is void — in which case the signed append-only database alternative is the better engineering decision, and the POC will have cost eight weeks rather than eighteen months to find that out.
