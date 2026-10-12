# Crustdata — agent guidance

**Best for:** structured company/person search and signals (headcount growth, job posts, funding) in phase 2. In the MVP: person enrichment by LinkedIn URL with `business_email`.

**Operations (adapter `src/providers/crustdata.ts`):**
- `person_enrich` — `GET /screener/person/enrich?linkedin_profile_url=…&fields=business_email,…`, header `Authorization: Token <key>`.
- `company_enrich` — `GET https://api.crustdata.com/screener/company?company_domain=` → `{name, linkedin_url, country, industry, headcount, headcount_growth_6m_pct, funding_total_usd}`. The only source of headcount growth in `company-signals` (no free equivalent).
- `company_search` — `POST https://api.crustdata.com/screener/company/search {filters:[{filter_type: REGION|COMPANY_HEADCOUNT|INDUSTRY|KEYWORD, type:'in', value}], page}` → `{companies[{name,domain,linkedin_url,employee_count,country}], total}`. Headcount is mapped to Crustdata bands (1-10, 11-50, 51-200…), ISO country codes to names.

**Pricing basis:** per_result (~1 credit per returned person); empty results free. Estimate 2026-09-23.

**Pitfalls:**
- Needs `linkedin_url`; rows without it are `skipped:missing_input`.
- Filter on verified business email before paying in phase-2 searches; `limit:1` returns `total_count` for TAM sizing at the cost of one result.
- Some field groups return 403 depending on entitlement: drop the field and retry.
