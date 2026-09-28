# Scoring accounts and leads

Two dimensions, kept apart: **fit** (does this account look like the ones we win?) and **engagement** (is something happening there right now?). Rules first, with every reason auditable; a learned model only once it has been validated against a frozen reference.

## What exists in the engine

- `gtm run score-accounts --input '{"domains":[...]}'` — rules-based `account_fit` and `account_engagement` from `companies` + `signals`, graded A/B/C/D by percentile against the scored population frozen at run start (`src/core/scoring-rules.ts`, models `chift-account-fit-v1` / `chift-account-engagement-v1`, `validation: exploratory`). Every score carries `reasons` (feature, value, source) and a `miss_reason` when a feature lacks exactly one fresh observation.
- `src/core/scoring-contract.ts` — the pure replay scorer. It enforces the point-in-time contract: `known_at`, `event_at` and `retrieved_at` all strictly before the scoring instant; source classes by dimension (fit reads external sources, engagement reads first-party events, AE facts are excluded); staleness windows per feature (`max_age_days`); midrank percentile grading against a frozen `Reference`. A score is `null`, never a guess, when any weighted feature lacks exactly one eligible observation.
- Feeds: `company-signals` (funding, job openings, headcount growth) and `linkedin-signals` write the `signals` table; `company-enrich` fills `companies`. Scoring makes no provider call.

## Method

1. **Freeze the decision first**: product, decision date, horizon, population, unit (account or lead), outputs. Fit, engagement, capacity and coverage are separate questions with separate scores.
2. **Resolve identities** (apex domain, parent group) before counting anything; split discovery and validation sets by time and by parent group, never at random across the same group.
3. **Check what each feature measures.** A job ad is advertised duties, not budget. A technology mention is not an installation. A funding round is a date and an amount, not intent.
4. **Rules before models.** Hand-set weights with named reasons beat a fitted model nobody can explain to an AE. Prevalence ratios from phrase counts are hypotheses, never weights.
5. **Freeze rules, aliases and reference before validation.** Anything changed after looking at validation labels is leakage.
6. **Name the state** in every delivery: `exploratory` (rules, no outcome data) or `validated` (measured lift on a held-out, time-split population for a named use case). The default models ship as `exploratory`.

## Reading a score

`grade A` = top quartile of the reference population for that dimension; `reasons` lists the features that fired with their source; `miss_reason` says why a feature was skipped (stale, missing, wrong source class). Re-score weekly, only rows never scored or older than 3 months (`references/scheduling.md`).
