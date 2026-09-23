# Crustdata — agent guidance

**Best for:** structured company/person search and signals (headcount growth, job posts, funding) in phase 2. In the MVP: person enrichment by LinkedIn URL with `business_email`.

**Operations (adapter `src/providers/crustdata.ts`):**
- `person_enrich` — `GET /screener/person/enrich?linkedin_profile_url=…&fields=business_email,…`, header `Authorization: Token <key>`.

**Pricing basis:** per_result (~1 credit per returned person); empty results free. Estimate 2026-09-23.

**Pitfalls:**
- Needs `linkedin_url`; rows without it are `skipped:missing_input`.
- Filter on verified business email before paying in phase-2 searches; `limit:1` returns `total_count` for TAM sizing at the cost of one result.
- Some field groups return 403 depending on entitlement: drop the field and retry.
