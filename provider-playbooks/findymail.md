# Findymail — agent guidance

**Best for:** finder whose returned emails are pre-verified (high hit precision, lower coverage); cheap verifier with a boolean verdict.

**Operations (adapter `src/providers/findymail.ts`, Bearer token):**
- `find_from_name` — `POST /api/search/name {name:"first last", domain}` → `{email, email_status, name, domain}`. `name` is built from `name`, or `first_name + last_name` (lower-cased, spaces kept).
- `find_from_linkedin` — `POST /api/search/linkedin {linkedin_url}` → `{email, email_status, name, domain, linkedin_url}`.
- `verify` — `POST /api/verify {email}` → `{email, email_status: valid|invalid, verified}`. Hit when `verified === true`.

**Pricing basis:** per_hit 1 credit on every tool (found email / verified address); misses are free. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- `email_status` on finders is `valid` unless the payload says `verified: false` (then `unknown`); the `verified` field's presence is unverified against docs — confirm on the first pilot fixture.
- 404 = person not found (free miss); 200 with `contact.email: null` is also a free miss (`no_email_found`).
- Findymail does not return catch-all guesses, so it is a good *first* finder leg on small companies where Hunter has no coverage, but expect more misses than Apollo.
- `verify` is boolean only (no `catch_all` / `unknown`): an `invalid` from Findymail on a catch-all domain should not overrule a `catch_all` from ZeroBounce.
