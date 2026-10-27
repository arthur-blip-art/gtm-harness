# Web — agent guidance

**Best for:** free page snapshots and DNS, no provider in between. Page diffs (competitor pricing, integration marketplaces, changelogs), customer logos on case-study pages, tech-stack hints.

**Operations (adapter `src/providers/web.ts`, no key):**
- `fetch_page` — plain `GET` with a browser user agent, 20 s timeout → `{title, text (≤ 20k chars, scripts and styles stripped), text_hash, links (absolute), scripts, generator}`. **Never cached**: a diff needs the live page.
- `dns` — `MX` + `TXT` records → mail provider, SPF includes (Zendesk, HubSpot, Salesforce…), site verifications. Cached.

**Pricing basis:** free.

**Pitfalls:**
- JavaScript-rendered pages return little text; prefer the static pricing or changelog URL, or a `/sitemap.xml` entry. When a page needs a browser, use an Apify actor instead.
- `text_hash` changes on any visible edit (a date in the footer included): the diff plays compare the extracted lines, not just the hash.
- Respect robots and rate: one fetch per page per run, schedules at most daily.
