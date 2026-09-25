# Finding companies and contacts

Discovery before enrichment. **Companies first, then people**: never start with a broad people search.

## Plays

- `icp-to-companies` — ICP filters (industries, countries ISO-2, headcount band, keywords, tech, limit, sources apollo|theirstack|crustdata). It first sizes each source with `limit:1` (most providers return the total for the price of one row), logs `sizing: apollo=… theirstack=… crustdata=…`, then buys page by page until `limit` distinct apex domains. `size_only:true` stops after sizing — use it to price the scope before asking for approval. Results land in `companies` with `field_sources.name = <source>`.
- `company-enrich` — one domain → profile merged by precedence apollo → pdl → crustdata (not a waterfall: every source that answers contributes missing fields; `fieldSources` names the winner per field). Batch: `gtm run company-enrich --csv domains.csv --out profiles.csv`.
- `company-to-people` — domain + titles[] (+ seniorities) → up to `limit` people (apollo search, prospeo fallback), deduped by LinkedIn URL. Output rows are ready for `name-domain-to-email:batch`.
- `icp-to-pipeline` — the composition: companies → people per company → email waterfall → optional `sync-hubspot`. One run id, one receipt with every child leg (`apollo_size`, `apollo`, `pattern`, …, `hubspot_upsert`).

## Rules

- Free or near-free sizing first (`size_only`, `hunter.email_count` for a domain's email volume).
- Escalate providers only when the current one lacks a filter you need. TheirStack for tech stacks and hiring, Crustdata for funding/investor filters, Apollo for the broadest firmographics.
- Stop at ~80% coverage; over-provision 1.4×N at the top of the funnel and let incomplete rows fall off.
- Keep source lineage: `source` on every company/person row; `companies.raw[<source>]` keeps the payload.
- Small companies (< 50 people) have near-zero coverage in most databases: use `person-to-linkedin` (Serper) then `person-linkedin-to-email` for them.

## Exit back to…

- rows exist, columns to fill → `enriching-and-researching.md`
- signals and scoring on the company list → `scoring.md`
