# Enriching: email waterfall

Use this doc when rows exist and columns must be filled. Discovery (finding companies/people) is a different phase, see `finding-companies-and-contacts.md`.

## The play: `name-domain-to-email`

**Input CSV.** Needs a first name, a last name, and a domain or a company name. Header aliases are detected (`Prénom`, `Nom`, `Website`, `Company`, `LinkedIn`…), override with `--column domain=Site`. A `linkedin_url` column unlocks the Crustdata leg and improves Apollo/FullEnrich accuracy. Sales Navigator URLs are rejected by every provider.

**Pre-step.** Rows with a company but no domain get one Exa search (`<company> official website`, first non-social result → apex). Recorded as `resolve_domain` in the receipt.

**Legs, in order** (order IS the economics; each leg runs over every row still without an accepted email):

| # | leg id | provider/tool | bills | why here |
|---|---|---|---|---|
| 1 | `pattern` | millionverifier/verify_patterns | ~0.01 cr per pattern tried | free-ish; catches `first.last@` at most companies; stops at first `ok`; stops early on catch-all domains |
| 2 | `apollo` | apollo/people_match | 1 cr per revealed email | biggest database, verified statuses |
| 3 | `fullenrich` | fullenrich/bulk_enrich | 1 cr per email found | 20+ sources waterfall, async, batches of 50 |
| 4 | `crustdata` | crustdata/person_enrich | 1 cr per result | needs `linkedin_url`; skipped otherwise |
| 5 | `pdl` | peopledatalabs/person_enrich | ~3 cr per 200 | expensive, unverified emails → HOLD unless verified |
| 6 | `verify` | millionverifier/verify | ~0.01 cr | validate once per final address: HOLD candidates get one check; `ok` promotes to HIGH |

A leg whose key is missing is `skipped:leg_disabled` on every row; the play still runs. Restrict legs with `--legs apollo,fullenrich`.

**Accept rule.** A candidate is accepted when its canonical status is `valid` AND its apex domain equals the row's domain. Otherwise the row continues to the next leg (a `catch_all` from two independent legs on the same address is accepted as MEDIUM at the end). See `references/email-status-policy.md`.

## Export contract

Original columns, then: `row_key, run_id, email, email_status, email_source, confidence, miss_reason`, then one column per leg `email_result__<leg>` with `hit:<addr>:<raw_status>` | `miss:<reason>` | `error:<msg>` | `skipped:<reason>` | `not_reached`, `(cached)` appended when served from cache. `miss_reason` is null iff `email` is present. Values: `no_match_all_legs`, `invalid_only`, `no_legs_enabled`, `domain_mismatch`, `leg_error:<provider>`, `budget_abort`.

## Cache, reruns, resume

Every provider call is a receipt keyed by (provider, tool, sha256(normalized input)). A rerun over the same CSV reads receipts instead of buying: expect `receipts: 0 new / N cached` and `credits: 0`. Rows already at HIGH are skipped entirely. `--refresh` bypasses both. A crash mid-leg is safe: cells are persisted per row as they complete, and the next run resumes from the receipts.

## Reading the receipt

`rows in / accepted / credits / marginal credits per accepted` then one line per leg. `NEVER REACHED` = every row was already accepted before this leg (good). `CUT CANDIDATE` = spent credits, accepted nothing: drop or move it. Details in `references/cost-receipt.md`.

## After the run

1. `gtm audit --csv out.csv` (email/domain consistency).
2. Show the rows and the receipt line; recommend: which legs to keep, whether HOLD rows deserve a verifier key, whether to scale.
3. Golden records are written to `people` / `companies` with `field_sources` and `confidence`.

## Exit back to…

- rows do not exist yet → `finding-companies-and-contacts.md`
- copy or scoring on enriched rows → `writing-outreach.md`
