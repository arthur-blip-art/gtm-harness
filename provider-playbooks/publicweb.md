# Public web feeds — agent guidance

**Best for:** free situational data for any company, any country: dated press (funding, executive hires, launches, expansion), developer chatter, US funding filings.

**Operations (adapter `src/providers/publicweb.ts`, no key):**
- `news_search` — Google News RSS `{q, days, hl, gl}` → `{items[{title,link,published_at,source}]}`. Query with the company name in quotes; `core/site.ts` keeps only titles that name the company and classifies them (`core/signal-rules.ts`).
- `hn_search` — Hacker News via Algolia `{query, days}` → `{hits[{title,url,hn_url,created_at,points,comments,author,text}]}`. Launches (Show HN) and mentions of dev-tool SaaS.
- `form_d_search` — SEC EDGAR full-text search for Form D `{company, since}` → `{filings[{filed_at,names,cik,url}]}`. A Form D is a US private offering: a funding round, dated, before the press release. Set `SEC_USER_AGENT="Company contact@email"` (SEC policy).

**Pricing basis:** free. Verified on: 2026-10-08 (verify against docs).

**Pitfalls:**
- Google News links are Google redirect URLs: fine as a source to cite, resolve before scraping.
- A namesake is the classic false positive ("Pilot", "Ramp"): the name filter is strict, but read the headline before using it as a first line.
- Form D names the issuer entity, which can differ from the brand: match on the legal name when you have it.
