# PredictLeads — agent guidance

**Best for:** company-level buying signals keyed by domain: funding rounds and open job postings (with categories) — used for scoring, not for contacts.

**Operations (adapter `src/providers/predictleads.ts`, headers `X-Api-Key` + `X-Api-Token`):**
- `financing_events` — `GET /api/v3/companies/{domain}/financing_events` → `{domain, events[{id,amount,currency,date,financing_type,categories,article_url}]}`. Hit when non-empty.
- `job_openings` — `GET /api/v3/companies/{domain}/job_openings?limit=100` → `{domain, jobs[{id,title,first_seen_at,last_seen_at,categories,url,location}]}`. Hit when non-empty.

**Pricing basis:** per_call 1 credit per company lookup on each tool; an empty result or an unknown company (404 → miss `company_not_found`) is still billed. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- Two-part auth: both `PREDICTLEADS_API_KEY` and `PREDICTLEADS_API_TOKEN` are required; a 401 means one of them is missing, not a data miss.
- Domain is reduced to the apex (`www.acme.com/` → `acme.com`); PredictLeads keys companies by apex domain.
- `job_openings` caps at 100; large employers will be truncated — sort by `first_seen_at` client-side and prefer TheirStack when you need `total`.
- Signal data is not a reason to enrich contacts; keep these calls in the scoring play so one domain is looked up once and cached.
