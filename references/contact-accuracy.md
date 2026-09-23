# Contact accuracy and golden records

Adapted from Deepline's contact-accuracy guidance.

- **Precedence, not averaging.** For each field, take the first source that has a value in a declared order, and record the winner in `field_sources` (`{"email":"fullenrich"}`). Never blend.
- **Keep upstream evidence as columns.** Per-leg cells (`email_result__<leg>`) are the audit trail; the final `email` cell is a projection.
- **Confidence tiers.** HIGH = `valid` from a leg or verifier; MEDIUM = corroborated catch-all; HOLD = single unverified candidate; LOW = nothing.
- **Freshness.** Treat an email verification older than 30 days as stale before a send; `people.email_verified_at` records it.
- **Wrong-person gates.** Domain mismatch rejects; a `catch_all` whose domain differs from the company is a strong wrong-person signal.
- **Audit before sending.** `gtm audit --csv` runs `scripts/validate-emails.py`. `scripts/contact-accuracy-audit.py` (SEND / REMOVE / RE-TARGET / VERIFY / REVIEW) and `scripts/validate-linkedin-names.py` are available for LinkedIn-enriched files; run them with `python3 scripts/<name> --help`.
