# Research: source discovery before spending

Use it before building a list or an enrichment route when the market, the signal or the dataset is unfamiliar: first find where the information already lives, then pick providers.

## Non-negotiables

- **Search live, never from memory.** Every public-source claim comes from a real query this session (`serper.google_search`, `exa.search`, `parallel.search`). Naming a dataset family from memory is a draft, not a finding.
- **Resolve datasets to exact artifacts**: file/endpoint name, canonical URL, a mirror, an open-source parser if one exists, and the statistical registry for sizing (INSEE/SIRENE, BCE/KBO, Companies House, BLS/Census in the US).
- Public sources first, providers second. Private sources (CRM, warehouse, product analytics, calls, sheets) are first-class.
- Custom language (buyer words, objections, competitor framing, community slang) is an output, not a by-product.
- Tiny probes (`limit:1`, `numResults:3`) before scale; never full-scope paid work without approval.
- Classify every source as `native` (adapter exists), `generic route` (search + extraction), `private connector`, or `missing provider`.

## Standard flow

1. **Parse the job**: OBJECTIVE, ENTITY_SCOPE, TIME_WINDOW (default 30 days), PRIVATE_SOURCES, PUBLIC_SOURCES, DATASET_LEADS, CUSTOM_LANGUAGE_OUTPUTS, OUTPUT. State the scope to the user before any call.
2. **Plan the queries** offline: `python3 scripts/query_design.py "<objective>" --depth quick|default|deep` → query type, tiered sources, per-source variants, extraction keys.
3. **Public fanout**: communities (Reddit, HN, X, LinkedIn posts), web (Serper/Exa), registries and open data (`site:data.gouv.fr`, `site:data.gov`, "<dataset> parser github"), market language (reviews, G2/Capterra, job posts).
4. **Coverage gate**: for each of the 11 source families in `references/research/source-map.md`, record native / generic / private / gap.
5. **Artifact gate**: each recommended dataset has its exact artifact, URL, mirror, parser, registry key. Family named ≠ done.
6. **Describe before pricing**: `gtm providers` and the provider playbooks give the basis; probe with the smallest call.
7. **Report** with `references/research/fanout-consolidation.md`'s template: Key Findings, What I learned, GTM Data Sources Found, Materializable Datasets, Market Language, Proprietary Data To Join Later, Route (native/generic/gap), Recommended Workflow, Cost Estimate (pilot / full / unknowns).

## Scope notes

- The plan is `query_design.py` plus this doc; no hosted planning service.
- Providers: serper, exa, parallel are native; Reddit/X/YouTube/TikTok need a scraper (Apify is not wired) → `generic route` or `gap`.
- Evaluation corpus: `evals/last30days-public-private-corpus.json` + `scripts/evaluate_public_private_corpus.py` check the planner offline.
