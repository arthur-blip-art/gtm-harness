# Scoring accounts and leads

Adapted from Deepline's `deepline-scoring` (original in `vendor/deepline-shared/scoring-SKILL.md`; 16 references in `references/scoring/`). Evidence first; rules or a separately evaluated model; never weights derived from phrase counts.

## What exists in the engine

- `gtm run score-accounts --input '{"domains":[...]}'` — rules-based `account_fit` and `account_engagement` from `companies` + `signals`, graded A/B/C/D by percentile against the scored population frozen at run start (`src/core/scoring-rules.ts`, models `chift-account-fit-v1` / `chift-account-engagement-v1`, `validation: exploratory`). Every score carries `reasons` (feature, value, source) and a `miss_reason` when a feature lacks exactly one fresh observation.
- `src/core/scoring-contract.ts` — the pure replay scorer (port of Deepline's contract): point-in-time checks (`known_at`, `event_at`, `retrieved_at` all before the scoring instant), source-class rules (fit = external, engagement = first-party events, AE facts excluded), staleness windows, midrank percentile grading.
- `scripts/analyze_signals_v2.py` — evidence-first signal analysis on a `domain,status,website,jobs` CSV (won/lost/lookalike/unlabeled): phrase mining without labels, prevalence ratios with Wilson intervals and BH/BY corrections, always `scoring_eligible:false`.
- `scripts/dedupe_utils_v2.py` — net-new vs already-known against a customer/CRM list (apex domain, then fuzzy name).
- `scripts/technology_evidence.py` — offline gate for technology observations.

## Workflow (8 steps, from Deepline)

1. Freeze the decision: product, decision date, horizon, population, unit, outputs. Keep fit, engagement, capacity, coverage separate.
2. Resolve identities and parent groups; split discovery/validation by time and by parent; keep the full population.
3. Research workflows, roles, systems and counterexamples in public sources; mine discovery documents without labels (`references/scoring/keyword-catalog.md`, `buyer-language-research.md`).
4. Check collection with `references/scoring/quality-gate.md`; report coverage by source and outcome before citing lift.
5. Check what each feature measures (`signal-interpretation.md`): a job ad is advertised duties, not budget; a mention is not an installation.
6. Freeze rules, aliases, model and reference before validation (`scoring-pitfalls.md`).
7. Deliver a checked play that resolves the identifier, enriches the row and returns the requested outputs (`scoring-delivery.md`); prove parity separately from usefulness.
8. One readable report (`report-template.md`); name the state: `research_only`, `replay_only`, `exploratory_end_to_end`, `validated_for_named_use_case`.

`references/scoring/proven-signals.md` is a hypothesis library, not a weight table.
