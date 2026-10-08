# Serper — agent guidance

**Best for:** Google SERP as JSON at ~$0.001/query: LinkedIn URL lookup (`site:linkedin.com/in "First Last" Company`), website resolution, `site:` existence checks.

**Operations (adapter `src/providers/serper.ts`, header `X-API-KEY`):**
- `google_search` — `POST https://google.serper.dev/search {q, num (default 10), gl (default 'fr'), hl?}` → `{results[{title,link,snippet,position}], q, credits}`. Hit when `organic` is non-empty. Also the people dork of `company-to-people`: `site:linkedin.com/in "<title>" "<company>"` (~$0.001 a title, before any paid people search), and domain resolution for registry companies.
- `news` — `POST https://google.serper.dev/news {q, gl, tbs}` → `{items[{title,link,date,source,snippet}]}`. Paid fallback (~$0.001) when free Google News RSS returns nothing.
- `places` — `POST https://google.serper.dev/places {q, gl}` → `{places[{title,address,phone,website,rating,category}]}`. The company switchboard when the site shows no phone (~$0.003, 3 credits; verify).

**Pricing basis:** per_call 0.01 credit (~$0.001, 1 Serper credit) — billed even when there are no organic results. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- `gl` defaults to `fr`; set `gl:'us'` explicitly for non-French targets or LinkedIn results will skew to `fr.linkedin.com`.
- Only `organic` is mapped; knowledge graph / people-also-ask are dropped. Do not use for company facts.
- Queries are whitespace-normalised but case-preserved (quotes matter for Google); the cache key is therefore case-sensitive.
- LinkedIn lookup must still be identity-validated (name + company in `title`/`snippet`) before the URL is trusted — Serper returns matches, not verdicts.
