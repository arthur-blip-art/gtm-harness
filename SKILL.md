---
name: gtm
description: "GTM Harness: CLI-first GTM engine driven by a coding agent (waterfalls ordered by cost, pilot-before-scale, receipt cache, cost receipts, approval gate) with our own provider keys (23 adapters: harvestapi, apollo, fullenrich, hunter, zerobounce, leadmagic, prospeo, findymail, millionverifier, pdl, crustdata, lusha, kaspr, serper, exa, parallel, theirstack, predictleads, hubspot, github, web, hackernews, instantly) on Supabase. Plays: emails, LinkedIn URLs, phones, company enrich, tech stack, ICP→companies, company→people, signals (funding, jobs, champions who moved, GitHub SDK users, competitor customers), scoring, HubSpot sync, full pipeline; inbound triage and website visitors; suppression, Instantly drafts and campaign reports; deal health and closed-lost revival; competitor page watch, market watch, AI-answer visibility (AEO). Recipes: call prep, outbound launch, warm paths, competitor displacement, voice of market, social selling, deal check, custom demo, weekly GTM review. Also the accounts most worth writing to for Chift (\"trouve-moi 10 entreprises pertinentes pour Chift\"), and one account end to end: its decision makers, the context and a 3-step outbound sequence (\"trouve-moi des décideurs chez X et crée une séquence\", \"lead gen on this domain\"). Also: research method, scoring method, outreach contracts."
---

# GTM Engine (meta skill)

SKILL.md routes and sets policy. The matching doc supplies the execution contract: read it before running anything.

## CLI

```bash
gtm providers                                   # which keys are configured, price basis per tool
gtm providers scorecard --since 2026-09-01      # hit rate, credits per hit, cut candidates, from stored receipts
gtm plays                                       # every play with its input fields (* = required)
gtm csv show --csv in.csv                       # shape + detected columns + 2-row sample (never Read a CSV into context)
gtm run <play> --input '{...}' | --input @file.json   # scalar play (one person / company / ICP / watchlist)
gtm run <play> --csv in.csv --out out.csv --limit 3   # batch variant, pilot first
gtm run <play> --csv in.csv --out out.csv             # full run
gtm receipt <run-id>                            # frozen cost receipt
gtm signals pull --domains domains.txt          # company-signals over a domain list
gtm audit --csv out.csv                         # email/domain consistency check (exit 1 above 20% mismatch)
gtm cache stats · gtm db ping
```

`gtm` resolves `.env` from `GTM_HOME` (this repo), CSV paths from the current directory. Not on PATH: `node bin/gtm.mjs …` from the repo root. `--dry-run` exercises any play with mock providers and no database.

## Plays

| play | input | fills | doc |
|---|---|---|---|
| `name-domain-to-email` (+`:batch`) | first_name, last_name, domain or company | email | enriching-and-researching.md |
| `person-linkedin-to-email` (+`:batch`) | linkedin_url, domain? | email | enriching-and-researching.md |
| `person-to-linkedin` (+`:batch`) | first_name, last_name, company or domain | linkedin_url (name gate) | enriching-and-researching.md |
| `person-to-phone` (+`:batch`) | linkedin_url or name+domain | phone (MEDIUM max, no validator) | enriching-and-researching.md |
| `company-enrich` (+`:batch`) | domain | company profile → `companies` | finding-companies-and-contacts.md |
| `icp-to-companies` | ICP filters, limit, size_only | company list (sized with limit:1 first) | finding-companies-and-contacts.md |
| `company-to-people` | domain, titles[], limit | people rows for the email play | finding-companies-and-contacts.md |
| `company-signals` (+`:batch`) | domain | `signals` (funding, jobs, headcount) | scoring.md |
| `score-accounts` | domains?, model | `scores` account_fit / account_engagement | scoring.md |
| `sync-hubspot` | domains?, dry_run | HubSpot companies + contacts, `crm_sync` | references/schema.md |
| `icp-to-pipeline` | ICP filters + titles[] + sync? | companies → people → emails → HubSpot, one receipt | finding-companies-and-contacts.md |
| `linkedin-signals` | keywords[], competitors[], profiles[] (config file) | `signals` from LinkedIn via HarvestAPI + Slack alert; scheduled by GitHub Actions | recipes/linkedin-signals.md |
| `suppress` | people[] (email/domain/linkedin), cooldown_days=84 | kept / dropped with reason (customer, partner, open deal, opted out, contacted or touched < cooldown); free | runs inside push-sequencer and inbound-triage |
| `inbound-triage` | since_hours=24 or contacts[], write=false | new HubSpot contacts → disqualify early → enrich + score → hot/warm/cold/disqualified, next action, angle; Slack digest | recipes/inbound-triage.md |
| `site-visitors` | visits[{domain, pages[], visits}] (any de-anonymiser export) | page-weighted intent → enrich + score; customers flagged `customer_expansion` | recipes/inbound-triage.md |
| `people-moves` | people[{linkedin_url, company, relation}] or from_store | champions who changed company → `job_change` on the new domain + Slack | recipes/warm-paths.md |
| `github-signals` | sdk_queries[], repos[], enrich=false | orgs importing or starring competitor SDKs, "missing integration" issues → domains; free (GITHUB_TOKEN) | recipes/competitor-displacement.md |
| `company-tech` (+`:batch`) | domain | stack from homepage scripts + DNS → `companies.tech`, `competitor_detected`; free | recipes/call-prep.md |
| `competitor-customers` | competitors[{name, domain, customer_pages[]}] | named customers of Codat/Merge/… with confidence + evidence URL | recipes/competitor-displacement.md |
| `competitor-watch` | pages[{competitor, url, kind}] | pricing/integrations/changelog diffs (baseline first, then added/removed lines); free | recipes/weekly-gtm-review.md |
| `market-watch` | keywords[], window | news + Hacker News, classified (regulation, competitor, funding, pain…) | recipes/weekly-gtm-review.md |
| `aeo-visibility` | questions[], brand, competitors[] | share of mention in AI answers (Exa answer), gaps = questions where only competitors appear | recipes/weekly-gtm-review.md |
| `push-sequencer` | campaign, steps[], leads[], dry_run_only=true | checks (confidence, variables, copy) + suppress → Instantly **draft** + touches recorded; never activates | recipes/outbound-launch.md |
| `campaign-report` | campaign_ids[] | reply / opportunity / bounce rates, winning variant per step, verdicts; never opens | recipes/outbound-launch.md |
| `deal-health` | stale_days=21, write=false | open deals: no next step, close date past, stale → healthy / watch / critical | recipes/deal-check.md |
| `closed-lost-revival` | min_days_since_loss=60 or deals[] | lost deals with a signal **after** the loss, revival score + angle by loss reason | recipes/revive-closed-lost.md |

## Routing: read the matching doc first

| When the task involves… | Read |
|---|---|
| Finding emails, phones, LinkedIn URLs; enriching a CSV; leg orders; HOLD rows; reruns | [enriching-and-researching.md](enriching-and-researching.md) |
| Step-by-step email enrichment of a CSV | [recipes/name-domain-to-email.md](recipes/name-domain-to-email.md) |
| Building a company list from an ICP, finding people at companies, the full pipeline | [finding-companies-and-contacts.md](finding-companies-and-contacts.md) |
| Signals, account scoring, won/lost analysis | [scoring.md](scoring.md) |
| Source discovery before spending, public datasets, buyer language | [research.md](research.md) |
| A list of companies relevant to Chift ("give me 10 companies", "trouve-moi 10 entreprises pertinentes"), customers, competitors and known accounts removed | [recipes/find-accounts.md](recipes/find-accounts.md) |
| One account: its decision makers, the context and a 3-step sequence ("find decision makers at X and write the sequence") | [recipes/account-to-sequence.md](recipes/account-to-sequence.md) |
| Qualification and sequence contracts (JSON) | [writing-outreach.md](writing-outreach.md) |
| Writing or auditing the copy itself (cold email, LinkedIn DM, call opener; 8 checks + Swap Test) | the `cold-outreach` skill (`~/.claude/skills/cold-outreach`); the angle first with `account-pains` |
| An upcoming trade show, conference or dinner: who will be there, who to meet, top 5 and briefs | the `event-brief` skill, `skills/event-brief/SKILL.md` |
| French SMEs invisible to Apollo/LinkedIn (BTP, services, industry): sourcing by SIREN from public data (public procurement DECP, France Travail La Bonne Boîte, CNPP certifications, INPI ratios, Recherche d'entreprises), independence check, sale signals | `~/Documents/Corpo/arbitrage-case/RECAP.md` and its scripts (to become a `fr-public-to-companies` play) |
| A recurring buying-signal pipeline on Apify (job posts, funding, LinkedIn posts) into a deduplicated leads.csv | the `apify-buying-signal-detection` skill, `skills/apify-buying-signal-detection/SKILL.md` |
| Scoring a list of company URLs from plain-English rules (tech stack, site content) and finding department contacts with Apify | the `apify-lead-scoring-enrichment` skill, `skills/apify-lead-scoring-enrichment/SKILL.md` |
| Verified emails from Google Maps, Google search or a URL list, without a third-party verifier (good for local businesses) | the `apify-verified-email-finder` skill, `skills/apify-verified-email-finder/SKILL.md` |
| LinkedIn buying signals, competitor engagement, tracked people | [recipes/linkedin-signals.md](recipes/linkedin-signals.md), `provider-playbooks/harvestapi.md` |
| New inbound leads, "trie les leads entrants", demo requests, website visitors | [recipes/inbound-triage.md](recipes/inbound-triage.md) |
| Preparing a discovery or partner call, "prépare mon call avec X" | [recipes/call-prep.md](recipes/call-prep.md) |
| From a list to a sent campaign: checks, suppression, Instantly draft, report at D+7 | [recipes/outbound-launch.md](recipes/outbound-launch.md) |
| Lost deals and no-shows worth reopening | [recipes/revive-closed-lost.md](recipes/revive-closed-lost.md) |
| Warm introductions: shared investors, customers, ledger partners, former colleagues | [recipes/warm-paths.md](recipes/warm-paths.md) |
| Accounts on Codat / Merge / Apideck / Rutter, competitor SDK users, displacement | [recipes/competitor-displacement.md](recipes/competitor-displacement.md) |
| Buyer language, objections, verbatims from reviews, losses and replies | [recipes/voice-of-market.md](recipes/voice-of-market.md) |
| Commenting before writing, KOLs, LinkedIn social selling | [recipes/social-selling.md](recipes/social-selling.md) |
| One open deal: health, MEDDICC, next action | [recipes/deal-check.md](recipes/deal-check.md) |
| A tailored demo on the Chift sandbox | [recipes/custom-demo.md](recipes/custom-demo.md) |
| A prospect replied ("il m'a répondu", objection, "pas maintenant") | the `reply-handler` skill (`~/.claude/skills/reply-handler`) |
| A lost deal with a recorded call: the reactivation email | the `closed-lost-reactivation` skill, after `closed-lost-revival` |
| Who in my LinkedIn network can introduce me to X | the `warm-intro-finder` skill (local script on `Connections.csv`), in [recipes/warm-paths.md](recipes/warm-paths.md) |
| Leads from competitor reviews (G2, Capterra) | the `review-extractor` skill, in [recipes/competitor-displacement.md](recipes/competitor-displacement.md) |
| A customer win to turn into a case study and proof points | the `case-study-machine` skill |
| Duplicate contacts or companies in HubSpot | the `crm-duplicate-detector` skill (plan only, merges stay manual) |
| The weekly routine: campaigns, deals, competitor and market watch, AEO, people moves | [recipes/weekly-gtm-review.md](recipes/weekly-gtm-review.md) |
| Provider hit rates, cost per hit, which legs to cut | `gtm providers scorecard --since <date>` |
| Scheduling, cron, alerts, "how do we get pinged" | [references/scheduling.md](references/scheduling.md) |
| Provider pricing, payloads, pitfalls | `provider-playbooks/<provider>.md` (23 files) |
| Tables, columns, RGPD | [references/schema.md](references/schema.md) |
| Which statuses are sendable | [references/email-status-policy.md](references/email-status-policy.md) |
| Reading a receipt | [references/cost-receipt.md](references/cost-receipt.md) |
| Golden records, accuracy audit | [references/contact-accuracy.md](references/contact-accuracy.md) |

`agents/execution-plan-creator.md` produces a plan (goal, governing docs, pilot vs full-run steps, approval gate, risks) without running anything.

## Policy

**Pilot → price → fix → full run.** Every paid CSV run starts with `--limit 3` (a scalar play takes its own `limit` in `--input`; `--limit` only trims CSV rows) (or the whole file when it has ≤ 25 rows and the user stated the scope). Read the receipt: per-leg hits, misses, credits. Fix the route (`--legs`) before scaling. Do not buy the same failure at full scale. **The pilot is never the deliverable**: the task ends when the FULL input has run and the export sits at the exact `--out` path the user asked for.

**Approval gate.** A user-stated bounded scope (“these 30 contacts”, “everyone in this CSV”) is the approval: pilot, complete, report cost with the result. Stop and ask only when the scope is open-ended (`icp-to-companies` without a limit, "build me a big list"), the pilot reveals a problem, or projected spend exceeds a stated budget. Then use exactly these four headers and end with `Approve full run?`:

```
## Assumptions
## CSV Preview (ASCII)
## Credits + Scope + Cap
## Approval Question
```

Stay in AWAIT_APPROVAL until the user confirms. Approval of the pilot is not approval of the full run. The rule is also enforced by `.claude/hooks/gtm-gate.sh` (Claude Code PreToolUse): read-only and `--dry-run` commands pass silently, pilots up to 3 rows pass, any paid full run, `--refresh`, HubSpot write or schema push asks first. `--max-credits` is a soft cap: the run aborts once spend passes it; rows already processed are kept and the rerun resumes from cache.

**Size before buying.** `icp-to-companies --input '{..., "size_only": true}'` returns the totals for one row per source. Over-provision ~1.4×N and drop incomplete rows; never chase misses by hand. Companies first, then people.

**Prefer price-on-hit.** Finders that bill on success (apollo, fullenrich, hunter, leadmagic, findymail, prospeo, pdl, lusha, kaspr) fan out after a pilot; per-call legs (verifiers, serper, exa) are cheap by design. Price tables carry a `verifiedOn` date: estimates until checked on the provider dashboard. Phones have no validator: MEDIUM at best.

**Cache is the default.** Identical (provider, tool, normalized input) is never bought twice; children of a pipeline share the parent's cache and receipt. `--refresh` re-buys deliberately. HubSpot writes are never cached; unchanged records are skipped by hash.

**Working directory.** Inputs and exports live next to the user's project (e.g. `./gtm-data/<slug>/`), never in /tmp. Never read a large CSV with the Read tool.

**Decision-ready output.** After a run show the real rows (Markdown table: name, domain, email, status, confidence), then the receipt line (rows in / accepted / credits / marginal credits per accepted), then one concrete recommendation.

**Personal data.** Work emails and business phones only; never personal emails. `people.do_not_contact` is honoured by `sync-hubspot`. See references/schema.md.
