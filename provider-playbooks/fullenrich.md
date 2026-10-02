# FullEnrich — agent guidance

**Best for:** highest-coverage email waterfall (20+ sources) when Apollo misses; people search at a known domain when Apollo's free plan has no search API. Personal emails and phones exist but are not used here.

**Operations (adapter `src/providers/fullenrich.ts`):**
- `bulk_enrich` — `POST /api/v1/contact/enrich/bulk` with ≤ 50 contacts (`firstname`, `lastname`, `domain`, optional `linkedin_url`, `enrich_fields:["contact.emails"]`, `custom.idx`), then `GET /bulk/{enrichment_id}` every 15 s until FINISHED (max 15 min).

- `search_people` — `POST /api/v2/people/search` with `current_company_domains` (exact match), `current_position_titles`, `current_position_seniority_level` (each a list of `{value, exact_match}`), `limit` ≤ 100. Returns names, current title, LinkedIn URL; never emails. First leg of `company-to-people`.

**Pricing basis:** search_people 0.25 credit per person returned, free when that person was already exported once (`metadata.credits` gives the exact spend, used as the receipt cost). bulk_enrich per_hit, ~1 credit per email found; phones ~10×, never requested. Verified on: estimate 2026-09-23.

**Pitfalls:**
- Asynchronous: the `enrichment_id` is logged before polling. A cancelled local run still bills; do not resubmit, rerun and let the cache skip completed rows.
- Status hierarchy DELIVERABLE > HIGH_PROBABILITY > CATCH_ALL > INVALID; only DELIVERABLE is `valid`.
- LinkedIn URL lifts accuracy 5–20% for emails.
- Not a validator: do not use it to check addresses found elsewhere.
- Search filters within one field are OR, across fields AND. Keep `limit` small on a pilot: every returned person bills.
- Response field names (`most_probable_work_email` vs `most_probable_email`) are handled both ways; confirm on the first real pilot and record a fixture.
