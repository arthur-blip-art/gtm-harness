---
name: voice-of-market
description: "Build and refresh gtm-data/voice-of-market.md: themes, sourced verbatims and objections with answers, from competitor reviews, HubSpot loss reasons, sequence replies and Hacker News; read by cold-outreach and account-pains."
---

# Voice of market: the verbatim and objection bank

Copy written with the buyer's own words beats copy written with ours. One file, refreshed monthly, every line
sourced. Inspired by retriever.run `review-intelligence-digest` (gooses), `objection-mining` (gtmfly),
`review-site-scraper` (gooses), `winning-copy-extraction` (gtmfly).

## When to use

- "Qu'est-ce que les clients de Codat reprochent ?", "quelles objections reviennent ?", "banque de verbatims"
- "Mets à jour le voice of market", "comment répondre à 'on le construit nous-mêmes' ?"
- "Mine G2 reviews of Merge and Apideck", "what objections do we hear?", "refresh the objection bank"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Paraphrase reviews into "insights" | Bank full of our own words | Keep the exact quote, in its language, with URL and date |
| Quote a competitor review in a cold email | Disparagement, and the reader is not the reviewer | Verbatims shape our wording; they are never cited at a prospect (see `recipes/competitor-displacement.md`) |
| Paste reviewer names or emails from replies | Personal data in a shared file | Role and company size only ("CTO, 80-person HR SaaS") |
| One-off scrape, never refreshed | Objections from 2024 drive 2026 copy | Monthly refresh; dates on every line; drop > 18 months |
| Copy a whole review page into the file | Copyright, noise | Max 25 words per verbatim, the part that carries the pain |

## Steps

### Step 1: competitor reviews — [search]

G2 and Capterra pages for Codat, Merge, Apideck, Rutter (and Chift, for what customers praise).
- Static pages: `web.fetch_page` (free) on each review URL; little text back = JS-rendered.
- JS-rendered or paginated: an Apify review actor (search the store for "G2 reviews scraper"; pilot one product,
  max 50 reviews). Save raw output to `gtm-data/voice-of-market/raw/<source>-YYYY-MM.json`.
**Checkpoint:** reviews dated; filter to the last 18 months and to B2B software reviewers where the role is shown.

### Step 2: HubSpot loss reasons — [search]

```bash
gtm run closed-lost-revival --input '{"min_days_since_loss":0}' --dry-run
gtm run closed-lost-revival --input '{"min_days_since_loss":0}'
```
Keep `loss_reason`, notes text, competitor named. **Checkpoint:** ≥ 20 deals, else widen the period.

### Step 3: sequence replies — [search]

```bash
gtm run campaign-report --input '{"campaign_ids":["…"]}' --dry-run
gtm run campaign-report --input '{"campaign_ids":["…"]}'
```
Keep the reply texts classified as objection, interest, referral, not-now. Strip names and signatures.

### Step 4: Hacker News and market chatter — [search]

```bash
gtm run market-watch --input '{"keywords":["unified accounting api","Codat","accounting integrations","e-invoicing API","Peppol API"],"window":"month"}' --dry-run
gtm run market-watch --input '{"keywords":["unified accounting api","Codat","accounting integrations","e-invoicing API","Peppol API"],"window":"month"}'
```
Keep builder comments on build vs buy, pricing models, coverage complaints.

### Step 5: code the corpus — [transform]

For each item: theme, verbatim (≤ 25 words, original language), source URL, date, persona if known, sentiment.
Themes to start with (add, don't force): coverage of local ledgers · on-premise software · data model depth · sync
reliability · support speed · pricing model · build vs buy · time to market · e-invoicing · security and compliance.
**Checkpoint:** a theme needs ≥ 3 independent sources to be listed as a theme; otherwise "watch".

### Step 6: objections and answers — [compose]

For each objection heard ≥ 3 times: the words buyers use, the real concern behind it, our answer (fact + proof +
question), what not to say. Seed list to check against the corpus:

| Objection (their words) | Concern | Answer pattern |
|---|---|---|
| "We'll build it ourselves" | Control, cost | Ask how many connectors and who maintains them; Pleo 12–16 weeks per integration in-house; 22–44k per connector before maintenance |
| "We already use Codat / Merge" | Switching cost | "Alongside, for the French and Belgian ledgers": ask which ledgers their customers request that they can't serve |
| "Our customers are on Xero and QuickBooks" | No local need | Ask about the next country; who picks the ledger there (the accountant in FR and DE) |
| "Too expensive" | Budget model | Ask how integration work is budgeted today; compare with one engineer-quarter |
| "Not a priority this year" | Timing | Ask what would make it one: a country launch, e-invoicing, a lost deal |

### Step 7: write the file — [deliver]

`gtm-data/voice-of-market.md`, sections: `## Themes` (theme, count, 2–3 verbatims with source and date) ·
`## Objections` (table above, filled) · `## Words to use / avoid` (their phrasing vs ours) · `## Changelog`
(date, sources added). `cold-outreach` and `account-pains` read it when writing for a segment; mention it in their
prompt ("read gtm-data/voice-of-market.md first").

## Cost

`web.fetch_page`, HubSpot, `campaign-report`, `market-watch` (Hacker News): free. Apify review actor: per its
pricing, typically under $1 per 100 reviews; pilot one product first. A monthly refresh: < 1 credit + the actor.

## Output

`gtm-data/voice-of-market.md` (the bank), `gtm-data/voice-of-market/raw/` (sources, kept for audit).
