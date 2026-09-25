---
name: linkedin-signals
description: "Weekly LinkedIn buying signals for a list of keywords, competitors and tracked people, with Slack alerts for ICP matches."
---

# LinkedIn signals: keywords, competitor engagement, tracked people

Three agents, one play, one schedule. Nothing calls us; we pull, diff, alert.

## When to use

- "Qui parle d'intégration comptable cette semaine sur LinkedIn ?"
- "Qui a liké les posts de Codat et Merge ?"
- "Préviens-moi quand un des CTO de ma liste publie"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Pull every day with `posted_limit: month` | You pay the same posts 30 times | Cache dedupes by input hash, but a new day = a new window; use `week` daily or `month` weekly |
| Treat every engager as a lead | Sales gets students and vendors | Only `icp_match: true` rows go to Slack; the title regex is the gate |
| Send from the signal directly | Bounce, wrong person | A signal is a reason to write, not an address: run `person-linkedin-to-email` on the ICP matches |
| Promise the team a live feed | LinkedIn blocks, coverage drops | Fragile source by nature; keep web/job/funding signals alongside |

## Steps

### Step 1: define the watchlist — [transform]

**Input:** `config/linkedin-signals.chift.json`: `keywords[]`, `competitors[]` (company URLs), `profiles[]` (people URLs), `posted_limit`, `icp_title_pattern`.
**Output:** a config file committed to the repo.
**Checkpoint:** every URL is a `/company/` or `/in/` URL; keywords are phrases buyers write, not vendor jargon.
**Fallback:** start with 3 keywords and 2 competitors; widen after a week of reading the alerts.

### Step 2: dry-run — [search]

```bash
gtm run linkedin-signals --input @config/linkedin-signals.chift.json --dry-run
```

**Output:** receipt with one leg per agent call, counts by type, ICP matches.
**Checkpoint:** counts look right; `notified: skipped` (dry-run never posts).

### Step 3: first real pull — [search]

```bash
gtm run linkedin-signals --input @config/linkedin-signals.chift.json --max-credits 5
```

**Output:** rows in `signals` (types `linkedin_keyword_post`, `linkedin_competitor_engagement`, `linkedin_tracked_post`), Slack message with up to 10 ICP matches.
**Checkpoint:** cost per run in the receipt; expect cents. Read 20 signals by hand: are the ICP matches real buyers?
**Fallback:** too much noise → tighten `icp_title_pattern` or drop a keyword.

### Step 4: schedule — [deliver]

Add the secrets `DATABASE_URL`, `HARVESTAPI_API_KEY`, `SLACK_WEBHOOK_URL` to the GitHub repository. `.github/workflows/linkedin-signals.yml` runs weekdays at 06:00 UTC and falls back to `--dry-run` when a secret is missing, so it is green from day one. `workflow_dispatch` runs it by hand.

### Step 5: act — [enrich, deliver]

For each ICP match: `gtm run person-linkedin-to-email --input '{"linkedin_url":"…"}'`, then write with the post as the opening line (`gtm prompts show "Use company mission to write email first line"` adapted). `sync-hubspot` pushes the contact.

## Gotchas

| Gotcha | What happens | Fix |
|---|---|---|
| Company slug vs URL | `company_posts` misses | Always pass the full `https://www.linkedin.com/company/<slug>` URL |
| A keyword in two languages | Half the posts missed | Add both phrasings as separate keywords |
| Weekend runs | Empty | Cron is Mon–Fri by design |
| Same person engages 5 posts | 5 signals | Dedupe key includes the post; the Slack line is per person per post, on purpose (intensity is information) |
