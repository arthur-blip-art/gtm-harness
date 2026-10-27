---
name: weekly-gtm-review
description: "The 30-minute weekly GTM routine: campaign results, stale deals, competitor and market watch, GitHub signals, monthly AEO and bimonthly people moves, with the decisions to take and where to write them."
---

# Weekly GTM review: 30 minutes, every Monday

One pass over the outbound results, the pipeline and the market, ending in at most 5 decisions written down.
Inspired by retriever.run `sequence-performance` (gooses), `competitor-monitoring-system` (gooses),
`industry-scanner` (gooses), `hackernews-intel` (opendi), `aeo` (gooses), `champion-move-outreach` (gooses),
`github-repo-signals` (gooses).

## When to use

- "Fais la revue GTM de la semaine", "qu'est-ce qui a bougé cette semaine ?", "point du lundi"
- "Weekly GTM review", "what changed in the market this week?", "Monday pipeline and campaign check"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Read every output in full | 2 hours, no decision | Each block has a time box and a question it answers |
| Rank campaigns by opens | Apple MPP inflates opens, wrong winner | Replies, positive replies and meetings only |
| Run monthly checks weekly | Cost and noise | AEO monthly, people-moves every 2 weeks |
| Notes nobody finds | Same discussion next Monday | One file per week, decisions table at the top |
| Decide on 40 sends | Noise read as signal | No copy decision under 100 delivered per variant |

## Order and time boxes

### 1. Campaigns — 7 min — [search]

```bash
gtm run campaign-report --input '{"campaign_ids":["…"]}' --dry-run
gtm run campaign-report --input '{"campaign_ids":["…"]}'
```
Question: which variant and step win on positive reply rate; any bounce > 3 % (pause and check the list).
Decision: keep / rewrite step N / stop. Winning lines go to `gtm-data/voice-of-market.md` "Words to use".

### 2. Deals — 7 min — [search]

```bash
gtm run deal-health --input '{"stale_days":21}' --dry-run && gtm run deal-health --input '{"stale_days":21}'
```
Question: which deals have no next step. Decision: one `recipes/deal-check.md` per top-3 stale deal, this week.

### 3. Competitors — 5 min — [search]

```bash
gtm run competitor-watch --input @config/competitor-watch.json --dry-run && gtm run competitor-watch --input @config/competitor-watch.json
```
`config/competitor-watch.json` = `{"pages":[{"competitor":"Codat","url":"https://codat.io/pricing/","kind":"pricing"},{"competitor":"Merge","url":"https://merge.dev/integrations","kind":"integrations"},{"competitor":"Apideck","url":"https://www.apideck.com/changelog","kind":"changelog"},{"competitor":"Rutter","url":"https://www.rutter.com/integrations","kind":"integrations"}]}`
(verify URLs once). Question: new ledger in FR/Benelux, price change, new positioning. Decision: update the
battlecard lines in `recipes/competitor-displacement.md` angles, or nothing.

### 4. Market — 4 min — [search]

```bash
gtm run market-watch --input '{"keywords":["facturation électronique","plateforme agréée","Peppol","unified accounting API","Codat"],"window":"week"}' --dry-run
gtm run market-watch --input '{"keywords":["facturation électronique","plateforme agréée","Peppol","unified accounting API","Codat"],"window":"week"}'
```
Question: a regulatory date, a ledger launch or acquisition, a thread worth answering. Decision: a post idea for
`content-writing`, a sequence angle, or nothing.

### 5. GitHub signals — 3 min — [search]

```bash
gtm run github-signals --input '{"sdk_queries":["\"@codat/accounting\" filename:package.json","\"merge-api-client\" filename:requirements.txt","\"@apideck/unify\" filename:package.json"],"repos":["codatio/client-sdk-typescript"]}' --dry-run
```
(Then live; check repo names once.) Question: a new org in the ICP using a competitor SDK or asking for a missing
ledger in issues. Decision: add to `recipes/competitor-displacement.md` list.

### 6. Monthly (first Monday): AEO visibility — +5 min — [search]

```bash
gtm run aeo-visibility --input '{"questions":["best unified accounting API for France","Codat alternative Europe","API comptable unifiée","connect my SaaS to Pennylane and Exact"],"brand":"Chift","competitors":["Codat","Merge","Apideck","Rutter"]}' --dry-run
```
Question: share of answers mentioning Chift vs last month, and the pages engines cite. Decision: one page to write
or fix.

### 7. Every other Monday: people moves — +4 min — [search]

```bash
gtm run people-moves --input '{"from_store":true}' --dry-run && gtm run people-moves --input '{"from_store":true}'
```
Question: a champion moved to an ICP account, a new CTO/CPO/partnerships lead < 90 days at a target. Decision:
`recipes/warm-paths.md` line or `recipes/account-to-sequence.md` for that account.

## Decisions and notes

Write `gtm-data/reviews/YYYY-Www.md`, top first:

```markdown
# GTM review YYYY-Www
| # | Decision | Owner | Due | Source block |
|---|---|---|---|---|
## Numbers: sends, replies, positive, meetings (per campaign) · stale deals · competitor changes · market items
## Carried over from last week (done / not done)
```
Max 5 decisions. Deal actions also go in HubSpot as tasks.

## Cost

`campaign-report`, `deal-health`, `competitor-watch`, `market-watch`, `github-signals`: free (Instantly, HubSpot,
web, Hacker News, GitHub). `aeo-visibility`: exa answer ~0.05 per question, so ~2 credits for 40 questions a month.
`people-moves`: ~0.04 per profile checked (harvestapi `get_profile`). A normal week: under 1 credit.

## Output

`gtm-data/reviews/YYYY-Www.md`, HubSpot tasks, edits to the recipes' angle tables when the market changed.
