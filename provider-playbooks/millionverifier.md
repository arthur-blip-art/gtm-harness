# MillionVerifier — agent guidance

**Best for:** cheap deliverability checks. Powers leg 1 (pattern guessing) and the final verifier pass on HOLD rows.

**Operations (adapter `src/providers/millionverifier.ts`):**
- `verify` — `GET /api/v3/?api=…&email=…` → `result` in `ok | catch_all | unknown | invalid | disposable`.
- `verify_patterns` — tries up to 5 patterns (`first.last`, `first`, `flast`, `f.last`, `firstlast`) and stops at the first `ok`; stops immediately on `catch_all`.

**Pricing basis:** per_call, ~$0.001 (0.01 credit) per verification; `verify_patterns` reports the exact number of calls as `costOverride`.

**Pitfalls:**
- Catch-all domains make every pattern look the same: the leg stops after one call and defers to finders.
- `unknown` often means a slow mail server; rerun later rather than treating it as invalid.
- Optional: without the key, leg 1 and the verifier pass are skipped and more rows end in HOLD.
