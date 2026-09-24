# Prospeo — agent guidance

**Best for:** LinkedIn-URL-first email enrichment with a status, and people/company search by website + title + seniority.

**Operations (adapter `src/providers/prospeo.ts`, header `X-KEY`):**
- `enrich_person` — `POST /enrich-person {data:{linkedin_url} | {first_name,last_name,company_website}, enrich_email:true}` → `{email, email_status (raw provider casing, e.g. VALID|CATCH_ALL), first_name, last_name, job_title, linkedin_url, company_website, company_name}`. LinkedIn URL wins over name+website when both are given.
- `search_person` — `POST /search-person {filters:{company_website_or[], job_title_or[], seniority_or[]}, page, limit≤25}` → `{results[{first_name,last_name,job_title,linkedin_url,company_website,company_name}], total, page, limit}`.
- `search_company` — `POST /search-company {filters:{company_website_or[], company_name_or[], company_industry_or[], company_size_or[]}, page, limit≤25}` → `{results[{name,website,industry,size,linkedin_url}], total, page, limit}`.

**Pricing basis:** `enrich_person` per_hit 1 (no charge on miss); `search_person` / `search_company` billed per page of 25 → counted as per_call 1 whatever `limit` is. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- Search is billed per page, not per result: `limit: 5` costs the same as `limit: 25`. Size `limit` to what you will consume, and never page past `total`.
- `email_status` casing is the provider's (upper-case); normalise in the email policy, not in the adapter.
- Miss detection on `enrich-person` matches `NO_RESULT` / `NOT_FOUND` in the 400/404 body — record a fixture on the first pilot, the exact error code is unverified.
- Filters accept either `{filters:{...}}` or the keys at top level; arrays are lower-cased, de-duplicated and sorted for cache stability.
