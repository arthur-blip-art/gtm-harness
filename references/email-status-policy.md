# Email status policy

Canonical statuses: `valid`, `catch_all`, `unknown`, `invalid`, `disposable`. Provider raw statuses are mapped in `src/core/email-policy.ts`; anything unmapped is `unknown`.

| Provider raw | Canonical |
|---|---|
| apollo `verified` | valid |
| apollo `guessed`, `extrapolated`, `unverified` | unknown |
| apollo `unavailable` | invalid |
| fullenrich `DELIVERABLE` | valid |
| fullenrich `HIGH_PROBABILITY` | unknown |
| fullenrich `CATCH_ALL` | catch_all |
| fullenrich `INVALID` | invalid |
| millionverifier `ok` | valid |
| millionverifier `catch_all` / `unknown` / `invalid` / `disposable` | same |
| peopledatalabs (no verification) | unknown |
| crustdata `business_email` | valid |

Domain gate: apex(email) must equal apex(row domain). A mismatch is a wrong-person or previous-employer signal and is recorded as `miss:domain_mismatch:<addr>`, never accepted.

Decision after the last leg (precedence, not averaging):

| Candidates | Result |
|---|---|
| any `valid` | that address, HIGH, source = its leg |
| same address `catch_all` from 2+ legs | MEDIUM |
| one `catch_all` or `unknown` | value kept, HOLD (not sendable) → verifier pass |
| only `invalid` / `disposable` | null, `invalid_only` |
| nothing | null, `no_match_all_legs` |

Sendable = HIGH or MEDIUM. HOLD rows are kept in the export and in `people` with `confidence = HOLD` so a later verifier run can promote them.
