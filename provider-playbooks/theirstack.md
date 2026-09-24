# TheirStack — agent guidance

**Best for:** account discovery by technology stack + headcount + country, and hiring signals (job postings) per company domain, with a total pool count on every call.

**Operations (adapter `src/providers/theirstack.ts`, Bearer token):**
- `company_search` — `POST /v1/companies/search {limit, page, company_country_code_or[], employee_count_min, employee_count_max, industry_id_or?, technology_slug_or?, company_name_partial_match_or?, include_total_results:true}` → `{results[{name,domain,employee_count,country_code,industry,technology_slugs,linkedin_url}], total, page, limit}`.
- `job_search` — `POST /v1/jobs/search {company_domain_or[], posted_at_max_age_days (default 90, clamped to 1..180), job_title_pattern_or?, limit, page, include_total_results:true}` → `{results[{job_title,date_posted,url,company_domain,company_name,location}], total, page, limit}`.

**Pricing basis:** per_result — `company_search` 1 credit per company returned, `job_search` 0.5 per job. The adapter writes `costOverride = results.length × credits`. **`limit:1` for sizing bills one**: use it to read `total` before committing to a full pull. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- Every returned row is billed, whether or not you use it; `limit` is the budget. Page 0 is the first page.
- `posted_at_max_age_days` max is 180; older postings are not queryable. Default 90 keeps signals fresh.
- `technology_slugs` is normalised from either `technology_slugs` or `technologies_found[].technology.slug` — record which shape the API returns on the first pilot.
- Filters accept arrays only (`*_or`); the adapter sorts/dedupes them so the same ICP hashes to the same receipt.
