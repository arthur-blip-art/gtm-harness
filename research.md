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

1. **Parse the job**: objective, entity scope, time window (default 30 days), private sources available, outputs wanted. State the scope to the user before any call.
2. **Plan the queries offline**: one query type (who / where / how many / what do they say), two or three source-specific variants per family, the extraction keys you expect back. Write them down before running anything.
3. **Public fanout** with the smallest probes: communities (Reddit, HN, X, LinkedIn posts), web (`serper`, `exa`), registries and open data (`site:data.gouv.fr`, `site:data.gov`, "<dataset> parser github"), market language (reviews, G2/Capterra, job posts).
4. **Coverage gate**: for each source family touched, record native / generic route / private / gap. A family named from memory is not covered.
5. **Artifact gate**: each recommended dataset has its exact artifact, URL, mirror, parser, registry key.
6. **Describe before pricing**: `gtm providers` and the provider playbooks give the basis; probe with the smallest call and read the receipt.
7. **Report**: key findings, sources found (with artifacts), market language, private data to join later, route per source (native / generic / gap), recommended plays, cost estimate (pilot / full / unknowns).

## Scope notes

- Providers: serper, exa, parallel are native search legs; Reddit/X/YouTube/TikTok need a scraper (not wired) → `generic route` or `gap`.
- Research output feeds `icp-to-companies` (filters and keywords) and `writing-outreach.md` (buyer language); it never bypasses the pilot rule.
