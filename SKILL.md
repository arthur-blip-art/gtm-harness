---
name: gtm
description: "GTM Harness: CLI-first GTM engine driven by a coding agent (free sources first, waterfalls ordered by cost, pilot-before-scale, receipt cache, cost receipts, approval gate) with our own provider keys (26 adapters: a free layer of website, DNS, ATS job boards, Google News, Hacker News, SEC Form D and French registries; serper, exa, harvestapi, scrapecreators, scrapegraph; apollo, fullenrich, hunter, zerobounce, leadmagic, prospeo, findymail, millionverifier, pdl, crustdata, lusha, kaspr, parallel, theirstack, predictleads, hubspot; an LLM for briefs and drafts) on Supabase. The button: \"find me the right people and prepare sequences\" (prospect), and signals that turn into drafts on their own (signal-to-action). Plays: emails, LinkedIn URLs, phones, company enrich, ICP→companies, company→people, signals, account briefs, tech stack, social listening, scoring, sequence drafts, HubSpot sync. Also the accounts most worth writing to for Chift (\"trouve-moi 10 entreprises pertinentes pour Chift\"), and one account end to end: its decision makers, the context and a 3-step outbound sequence (\"trouve-moi des décideurs chez X et crée une séquence\", \"lead gen on this domain\"). Also: research method, scoring method, outreach contracts."
---

# GTM Engine (meta skill)

SKILL.md routes and sets policy. The matching doc supplies the execution contract: read it before running anything.

## CLI

```bash
gtm providers                                   # which keys are configured, price basis per tool
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
| `icp-to-companies` | ICP filters, seed_domains?, naf?, limit, size_only | company list: lookalikes and FR registry first, paid databases sized with limit:1 then bought for the rest | finding-companies-and-contacts.md |
| `company-to-people` | domain, titles[], limit | people rows: registry officers and LinkedIn dorks first, then FullEnrich / Apollo / Prospeo | finding-companies-and-contacts.md |
| `company-signals` (+`:batch`) | domain, paid: gap/always/never | `signals`: ATS jobs, news (funding, new exec, launch), SEC Form D, BODACC free first; PredictLeads / TheirStack / Crustdata for the gaps | scoring.md |
| `score-accounts` | domains?, model | `scores` account_fit / account_engagement | scoring.md |
| `sync-hubspot` | domains?, dry_run | HubSpot companies + contacts, `crm_sync` | references/schema.md |
| `icp-to-pipeline` | ICP filters + titles[] + sync? | companies → people → emails → HubSpot, one receipt | finding-companies-and-contacts.md |
| `linkedin-signals` | keywords[], competitors[], profiles[], champions[] (config file) | `signals` from LinkedIn via HarvestAPI (incl. champion job changes) + Slack alert; scheduled by GitHub Actions | recipes/linkedin-signals.md |
| **`prospect`** | ICP filters + seed_domains? + titles[] + offer | the button: accounts (free first) → signals → ranking → people → emails → briefs → 3-step drafts, files in out_dir | recipes/prospect.md |
| **`signal-to-action`** | titles[] + offer (+ since_days) | fresh signals → people → emails → brief → a draft that opens on the signal, once per signal; weekday cron | recipes/prospect.md |
| `account-context` | domain, offer? | one-page brief: pages, stack, jobs, news, switchboard, why now, angles with sources | recipes/market-intel.md |
| `tech-stack` (+`:batch`) | domain | stack from DNS, website source and job ads, with evidence → `companies.tech` | recipes/market-intel.md |
| `social-listening` | terms[], x_handles[] | mentions on HN, news, LinkedIn, Reddit, X, web; buying intent flagged → `signals` | recipes/market-intel.md |
| `draft-sequence` | domain, person, offer | 3 steps on the strongest dated fact, copy audit by code, `needs_review` reasons; never sends | recipes/prospect.md |

## Routing: read the matching doc first

| When the task involves… | Read |
|---|---|
| Finding emails, phones, LinkedIn URLs; enriching a CSV; leg orders; HOLD rows; reruns | [enriching-and-researching.md](enriching-and-researching.md) |
| Step-by-step email enrichment of a CSV | [recipes/name-domain-to-email.md](recipes/name-domain-to-email.md) |
| Prospects end to end: "find me the right people and prepare sequences", lead gen on a segment, who to call this week, a signal that should become an email | [recipes/prospect.md](recipes/prospect.md) |
| A brief before a call, the tech stack of an account, what people say about a brand or a competitor | [recipes/market-intel.md](recipes/market-intel.md) |
| Building a company list from an ICP, finding people at companies, the full pipeline | [finding-companies-and-contacts.md](finding-companies-and-contacts.md) |
| Signals, account scoring, won/lost analysis | [scoring.md](scoring.md) |
| Source discovery before spending, public datasets, buyer language | [research.md](research.md) |
| A list of companies relevant to Chift ("give me 10 companies", "trouve-moi 10 entreprises pertinentes"), customers, competitors and known accounts removed | [recipes/find-accounts.md](recipes/find-accounts.md) |
| One account: its decision makers, the context and a 3-step sequence ("find decision makers at X and write the sequence") | [recipes/account-to-sequence.md](recipes/account-to-sequence.md) |
| Qualification, sequences, personalization | [writing-outreach.md](writing-outreach.md) |
| An upcoming trade show, conference or dinner: who will be there, who to meet, top 5 and briefs | the `event-brief` skill, `skills/event-brief/SKILL.md` |
| LinkedIn buying signals, competitor engagement, tracked people | [recipes/linkedin-signals.md](recipes/linkedin-signals.md), `provider-playbooks/harvestapi.md` |
| Scheduling, cron, alerts, "how do we get pinged" | [references/scheduling.md](references/scheduling.md) |
| Provider pricing, payloads, pitfalls | `provider-playbooks/<provider>.md` (one per adapter) |
| Tables, columns, RGPD | [references/schema.md](references/schema.md) |
| Which statuses are sendable | [references/email-status-policy.md](references/email-status-policy.md) |
| Reading a receipt | [references/cost-receipt.md](references/cost-receipt.md) |
| Golden records, accuracy audit | [references/contact-accuracy.md](references/contact-accuracy.md) |

`agents/execution-plan-creator.md` produces a plan (goal, governing docs, pilot vs full-run steps, approval gate, risks) without running anything.

## Policy

**Free and contextual first.** For every capability the order is: what is public and free (the company's own site and job board, DNS, registries, news, filings), then cheap search (Serper ~$0.001, Exa ~$0.005), then $0.01 APIs (Apollo, Hunter), then paid waterfalls, then expensive research agents. The plays encode this order; do not reach for a paid source by hand when a free leg exists. `docs/capability-map.md` lists every capability, its sources and how it runs.

**Where the human decides.** Three points only: (1) the ICP, the personas and the offer, once, in a config file (ask for them, never invent them); (2) spend past the cap (the gate below); (3) anything that leaves the building: drafts are never sent, each one lists what to check (`needs_review`). Everything between is decided by the cascade and the LLM step inside the plays, with sources.

**Pilot → price → fix → full run.** Every paid run starts with `--limit 3` (or the whole file when it has ≤ 25 rows and the user stated the scope). Read the receipt: per-leg hits, misses, credits. Fix the route (`--legs`) before scaling. Do not buy the same failure at full scale. **The pilot is never the deliverable**: the task ends when the FULL input has run and the export sits at the exact `--out` path the user asked for.

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
