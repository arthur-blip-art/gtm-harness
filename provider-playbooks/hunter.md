# Hunter — agent guidance

**Best for:** cheap email finder + verifier with a public confidence score; `email_count` is a free coverage probe before spending a credit.

**Operations (adapter `src/providers/hunter.ts`):**
- `email_finder` — `GET /v2/email-finder?domain&first_name&last_name` → `{email, email_status, score, position, verification}`. `email_status` is `data.verification.status` (`valid|invalid|accept_all|webmail|disposable|unknown`, or null when Hunter did not verify).
- `email_verifier` — `GET /v2/email-verifier?email` → `{email, email_status, result, score}`. Hit only when `email_status === 'valid'`; every other status is a miss with `missReason = status`.
- `email_count` — `GET /v2/email-count?domain` → `{domain, total, personal_emails, generic_emails}`. Free. Miss when `total === 0`.

**Pricing basis:** `email_finder` per_hit 1 request credit (no charge on miss); `email_verifier` per_call 1 verification credit; `email_count` free. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- Non-send statuses: `invalid`, `accept_all`, `webmail`, `disposable` are never sendable; `accept_all` is a catch-all domain → route to a second validator or HOLD.
- Coverage is poor below ~50 employees; run `email_count` first and skip the finder when `total === 0` (saves the per_hit credit on domains Hunter has never crawled).
- `score` < 50 on the finder is a guess, not a find: treat as `unknown` even when `email_status` is null.
- Key is passed as a query-string `api_key`; the adapter never logs the URL. `errors[0].details` carries the reason on 4xx.
