# Apollo — agent guidance

**Best for:** largest B2B contact database; `people/match` returns one work email with a status per call.

**Operations (adapter `src/providers/apollo.ts`):**
- `people_match` — `POST /api/v1/people/match` with `first_name`, `last_name`, `domain` (+ `linkedin_url` when known); `reveal_personal_emails=false`, `reveal_phone_number=false`.

**Pricing basis:** per_hit, 1 export credit when an email is revealed; a person found without email is a free miss. Verified on: estimate 2026-09-23, check plan.

**Pitfalls:**
- API access requires a paid plan; 401/403 = key or plan, not a data miss.
- Rate limits per minute/hour/day; the runner is sequential and backs off on 429.
- `email_status`: only `verified` is sendable; `guessed`/`extrapolated` are HOLD until verified.
- Same-name people at large companies: the domain gate rejects mismatches, but check titles on the pilot.
