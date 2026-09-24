# ZeroBounce — agent guidance

**Best for:** authoritative single-email validation with rich sub-statuses (spamtrap, abuse, role, disposable); second opinion on catch-all domains.

**Operations (adapter `src/providers/zerobounce.ts`):**
- `validate` — `GET /v2/validate?api_key&email&ip_address=` → `{email, email_status, sub_status, free_email, mx_found, mx_record, smtp_provider, did_you_mean}`. `email_status` is the provider status with `-` → `_` (`valid|invalid|catch_all|unknown|spamtrap|abuse|do_not_mail`). Hit when `valid` or `catch_all` (usable verdict); miss otherwise with `missReason = email_status`.

**Pricing basis:** per_call, 1 credit per validation regardless of verdict. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- `catch_all` is a hit (the verdict is usable) but not a send-safe address; the email policy must still map it to `catch_all`, never `valid`.
- `do_not_mail` + `sub_status` `role_based` / `global_suppression` / `toxic`: suppress, do not retry elsewhere.
- Bad key or exhausted credits come back as HTTP 200 with `{error}`; the adapter turns that into an error result (never a miss).
- `unknown` with `sub_status` `greylisted` / `timeout` is retryable after a few minutes; `mailbox_not_found` is final.
- `did_you_mean` is worth surfacing to the play: a typo fix is cheaper than another finder leg.
