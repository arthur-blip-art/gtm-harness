# FullEnrich — agent guidance

**Best for:** highest-coverage email waterfall (20+ sources) when Apollo misses; personal emails and phones exist but are not used here.

**Operations (adapter `src/providers/fullenrich.ts`):**
- `bulk_enrich` — `POST /api/v1/contact/enrich/bulk` with ≤ 50 contacts (`firstname`, `lastname`, `domain`, optional `linkedin_url`, `enrich_fields:["contact.emails"]`, `custom.idx`), then `GET /bulk/{enrichment_id}` every 15 s until FINISHED (max 15 min).

**Pricing basis:** per_hit, ~1 credit per email found; phones ~10×, never requested. Verified on: estimate 2026-09-23.

**Pitfalls:**
- Asynchronous: the `enrichment_id` is logged before polling. A cancelled local run still bills; do not resubmit, rerun and let the cache skip completed rows.
- Status hierarchy DELIVERABLE > HIGH_PROBABILITY > CATCH_ALL > INVALID; only DELIVERABLE is `valid`.
- LinkedIn URL lifts accuracy 5–20% for emails.
- Not a validator: do not use it to check addresses found elsewhere.
- Response field names (`most_probable_work_email` vs `most_probable_email`) are handled both ways; confirm on the first real pilot and record a fixture.
