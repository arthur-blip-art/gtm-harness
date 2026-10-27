---
name: competitor-displacement
description: "Find accounts running Codat, Merge, Apideck or Rutter (customer pages, SDK on the site, LinkedIn engagement), score them, and write a displacement sequence on FR/Benelux coverage, price, support and e-invoicing, without disparagement."
---

# Competitor displacement: accounts on Codat, Merge, Apideck, Rutter

A vendor already paying for a unified API has the budget and the problem solved once; the opening is where the
competitor is weak for them: local ledgers in France and Benelux, on-premise software, e-invoicing, support in their
language. Inspired by retriever.run `customer-discovery` (gooses), `competitor-signals` (gooses),
`bridgebound-in-market-20` (coldiq), `competitor-post-engagers` (gooses).

## When to use

- "Trouve les clients de Codat en France", "qui utilise Merge ou Apideck dans notre ICP ?"
- "Séquence de remplacement pour les clients Rutter", "qui like les posts de Codat ?"
- "Find Codat customers in Benelux", "displacement campaign against Apideck", "who runs Merge's SDK?"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Target a logo from a 2021 case study | They left long ago, or never went live | Keep sources < 18 months, or confirmed by `company-tech` today |
| Treat a LinkedIn like on a Codat post as a customer | Vendors, job seekers, Codat staff | Engagement is a weak signal: it adds to the score, never qualifies alone |
| Write "Codat doesn't cover X" without checking | Wrong, and screenshot-able | Only claims read on the competitor's own public catalog, with the URL and date |
| Pitch a switch mid-contract | "We just signed for 2 years" | Ask about the renewal date; aim for the next ledger they need, alongside |
| Spam every logo | Competitor notices, community talk | 20 accounts max per wave, scored, suppressed |

## What not to say (disparagement rules)

- Never: "Codat is bad / expensive / dying", "their support is terrible", "they're pivoting away from you",
  reviews quoted out of context, any rumour about funding or layoffs.
- Never a competitor's price: we don't know their contract.
- Allowed: verifiable catalog facts with the date ("Codat's public integrations page lists no Cegid Quadra connector
  as of 2026-10-13"), Chift facts, customer proof from Chift's public case studies, questions.
- Frame as "alongside or instead": "for the French ledgers" lands better than "replace them".
- If the prospect criticises the competitor, listen; don't pile on.

## Steps

### Step 1: competitor customers — [search]

`gtm-data/displacement/competitors.json`:
`{"competitors":[{"name":"Codat","domain":"codat.io","customer_pages":["https://codat.io/customers/"]},{"name":"Merge","domain":"merge.dev","customer_pages":["https://merge.dev/customers"]},{"name":"Apideck","domain":"apideck.com","customer_pages":["https://www.apideck.com/customers"]},{"name":"Rutter","domain":"rutter.com","customer_pages":["https://www.rutter.com/customers"]}],"enrich":true}`
(check each URL first: customer pages move.)

```bash
gtm run competitor-customers --input @gtm-data/displacement/competitors.json --dry-run
gtm run competitor-customers --input @gtm-data/displacement/competitors.json
```

**Output:** account, competitor, source (case study, logo wall, "powered by", review), date, confidence; Chift
customers removed.
**Checkpoint:** read 10 sources by hand; drop logos with no date.

### Step 1b: unhappy users in competitor reviews — [search]

The `review-extractor` skill on the G2 / Capterra pages of Codat, Merge, Apideck, Rutter: 3-star reviews from the
last 90 days first (still paying, still frustrated), 2- and 4-star if volume is thin. Paste the page text when the
page is rendered in JavaScript. Output CSV keeps the review sentence as `review_quote` and `why_them`.
Then `gtm run company-enrich:batch --csv reviews.csv --out reviews-enriched.csv --limit 3` (pilot) and
`company-to-people` for the buyer: the reviewer is rarely the person who buys an API.
**Checkpoint:** never quote the review back to the prospect; reuse the problem, not the sentence.

### Step 2: confirm on their stack — [enrich]

```bash
gtm run company-tech --csv gtm-data/displacement/accounts.csv --out gtm-data/displacement/accounts.tech.csv --limit 3
gtm run company-tech --csv gtm-data/displacement/accounts.csv --out gtm-data/displacement/accounts.tech.csv
```

`competitor_detected` = SDK, script or connect widget seen on their site or docs → confidence HIGH.
Add `github-signals` hits (`sdk_queries` like `"@codat/accounting" filename:package.json`) as a second source.

### Step 3: LinkedIn engagement — [search]

Add the competitors' company URLs to `config/linkedin-signals.chift.json` (`competitors[]`), then:

```bash
gtm run linkedin-signals --input @config/linkedin-signals.chift.json --dry-run
```

Keep `linkedin_competitor_engagement` rows with `icp_match: true` whose company is in the account list, or is an ICP
vendor (then add it, confidence LOW).

### Step 4: score and pick 20 — [transform]

```bash
gtm run company-enrich:batch --csv gtm-data/displacement/accounts.csv --out gtm-data/displacement/accounts.enriched.csv --limit 3
gtm run score-accounts --input '{"domains":["…"]}' --dry-run
```

Rank: confidence (HIGH > MEDIUM > LOW) × fit grade × FR/Benelux exposure (their countries vs the competitor's local
coverage gap, from `integrations-signal` and the competitor's catalog page). Keep 20.

### Step 5: the displacement sequence — [compose]

`account-pains` per account, then `cold-outreach` WRITE + AUDIT. Angles, one per message:

| Angle | Use when | First line pattern |
|---|---|---|
| FR/Benelux coverage | They sell in FR/BE/NL and the competitor's catalog lacks a local ledger they need | "Your customers in Belgium run on WinBooks and Octopus; your current connector set covers neither (catalog, {{date}})." |
| On-premise ledgers | Sage 100, Cegid Quadra, EBP, ACD customers | "In France a large share of accounting firms still run on-premise software: Sage 100, Quadra, ACD." |
| E-invoicing | They issue invoices in FR or BE | "France's reception obligation started in September 2026, Peppol in Belgium in January." (only where Chift covers the flow today) |
| Support | Review verbatims on support in their language, from `gtm-data/voice-of-market.md` | Ask, don't claim: "How fast do ledger issues get fixed for your French customers?" |
| Price | Only as a question on how they're billed (per connection, per customer) | "Is your accounting connector cost per linked customer, or flat?" |

Proof: the Chift customer in their segment (table in `recipes/account-to-sequence.md`).
Write to `gtm-data/sequences/displacement-YYYY-MM/<domain>.md`.

### Step 6: suppress and push as draft — [deliver]

```bash
gtm run suppress --input @gtm-data/sequences/displacement-YYYY-MM/people.json --dry-run && gtm run suppress --input @gtm-data/sequences/displacement-YYYY-MM/people.json
gtm run push-sequencer --input @gtm-data/sequences/displacement-YYYY-MM/campaign.json --dry-run
```

## Cost

`competitor-customers`: free on web pages; serper ~0.01 per query and exa answer ~0.05 when it searches for
"powered by" mentions. `company-tech`, `github-signals`: free. `linkedin-signals`: cents per run. Contacts and emails:
price-on-hit waterfall, ~0.5–1 credit per accepted contact. A 20-account wave: ~15–25 credits.

## Output

`gtm-data/displacement/accounts.*.csv` (sources, confidence, score), `gtm-data/sequences/displacement-YYYY-MM/`,
HubSpot companies tagged with the competitor after `sync-hubspot`.
