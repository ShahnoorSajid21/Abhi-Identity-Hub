# POC Presentation Plan — superseded

**This document has been replaced by [`docs/POC_DEMO_RUNBOOK.md`](POC_DEMO_RUNBOOK.md).**

*Superseded 23 August 2026.*

---

The runbook is a superset of what was here. Everything in the original plan was
folded into it:

| Was here | Now in the runbook |
|---|---|
| The one-sentence pitch and the three honesty sentences | §0, §1 |
| The six-scene demo spine | §11–§17, with a full per-step template |
| The 30-minute timing | §27, alongside 10- and 20-minute cuts (§25, §26) |
| "The questions you will be asked" | §29 |
| "What is NOT built" | §23, §33 |
| Running it, and the rehearsal checklist | §30 |
| Fallbacks | §31 |
| The close and the two escalations | §28 |

## Why it was replaced rather than updated

Every step in the runbook was performed against the running application before
it was written down. That pass found seven things the original plan either
overstated or did not mention — three of them claims the plan actively told the
presenter to make. They are listed in §0 of the runbook. The two that would have
cost the most credibility in a Compliance review:

- **Selective disclosure could not be demonstrated from the console.** The React
  console never sends a `consentId`, so `/kyc/verify` returns `proof: null`
  through the UI. The queue panel the old plan pointed at shows *entitlement*,
  not disclosure. The runbook demonstrates the real proof over the API instead
  (runbook §17).
- **`npm run numbers` disagrees with the employer upload screen** — 65% saved
  against the app's 37% — because the script's upload model ignores staleness and
  freezes. The screen is the accurate one (runbook §12).

Both are the kind of detail that is fine to get wrong in a draft and expensive to
get wrong in the room.
