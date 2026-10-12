# Apollo — agent guidance

**Best for:** largest B2B contact database; `people/match` returns one work email with a status per call.

**Operations (adapter `src/providers/apollo.ts`):**
- `people_match` — `POST /api/v1/people/match` with `first_name`, `last_name`, `domain` (+ `linkedin_url` when known); `reveal_personal_emails=false`, `reveal_phone_number=false`.
- `mixed_people_search` — `POST /api/v1/mixed_people/search {q_organization_domains_list, person_titles, person_seniorities, per_page, page}` → `{people[{first_name,last_name,title,linkedin_url,domain}], total}`. ~$0.01 flat per page (GooseWorks and Orthogonal figures), no email revealed: the cheapest paid people search.
- `mixed_companies_search` — `POST /api/v1/mixed_companies/search {organization_locations, organization_num_employees_ranges, q_organization_keyword_tags, per_page, page}` → `{companies[{name,domain,linkedin_url,employee_count,country,industry}], total}`. Size with `per_page: 1` first.
- `organizations_enrich` — `GET /api/v1/organizations/enrich?domain=` → name, LinkedIn, location, industry, headcount, funding, technologies. ~$0.01 a call.

**Pricing basis:** per_hit, 1 export credit when an email is revealed; a person found without email is a free miss. Verified on: estimate 2026-09-23, check plan.

**Pitfalls:**
- API access requires a paid plan; 401/403 = key or plan, not a data miss.
- Rate limits per minute/hour/day; the runner is sequential and backs off on 429.
- `email_status`: only `verified` is sendable; `guessed`/`extrapolated` are HOLD until verified.
- Same-name people at large companies: the domain gate rejects mismatches, but check titles on the pilot.
