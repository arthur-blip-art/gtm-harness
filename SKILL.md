---
name: gtm
description: "GTM Harness: CLI-first GTM engine driven by a coding agent (waterfalls ordered by cost, pilot-before-scale, receipt cache, cost receipts, approval gate) with our own provider keys (19 adapters: harvestapi, apollo, fullenrich, hunter, zerobounce, leadmagic, prospeo, findymail, millionverifier, pdl, crustdata, lusha, kaspr, serper, exa, parallel, theirstack, predictleads, hubspot) on Supabase. Plays: emails, LinkedIn URLs, phones, company enrich, ICP→companies, company→people, signals, scoring, HubSpot sync, full pipeline. Also one account end to end: its decision makers, the context and a 3-step outbound sequence (\"trouve-moi des décideurs chez X et crée une séquence\", \"lead gen on this domain\"). Also: research method, scoring method, outreach contracts."
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
| `icp-to-companies` | ICP filters, limit, size_only | company list (sized with limit:1 first) | finding-companies-and-contacts.md |
| `company-to-people` | domain, titles[], limit | people rows for the email play | finding-companies-and-contacts.md |
| `company-signals` (+`:batch`) | domain | `signals` (funding, jobs, headcount) | scoring.md |
| `score-accounts` | domains?, model | `scores` account_fit / account_engagement | scoring.md |
| `sync-hubspot` | domains?, dry_run | HubSpot companies + contacts, `crm_sync` | references/schema.md |
| `icp-to-pipeline` | ICP filters + titles[] + sync? | companies → people → emails → HubSpot, one receipt | finding-companies-and-contacts.md |
| `linkedin-signals` | keywords[], competitors[], profiles[] (config file) | `signals` from LinkedIn via HarvestAPI + Slack alert; scheduled by GitHub Actions | recipes/linkedin-signals.md |

## Routing: read the matching doc first

| When the task involves… | Read |
|---|---|
| Finding emails, phones, LinkedIn URLs; enriching a CSV; leg orders; HOLD rows; reruns | [enriching-and-researching.md](enriching-and-researching.md) |
| Step-by-step email enrichment of a CSV | [recipes/name-domain-to-email.md](recipes/name-domain-to-email.md) |
| Building a company list from an ICP, finding people at companies, the full pipeline | [finding-companies-and-contacts.md](finding-companies-and-contacts.md) |
| Signals, account scoring, won/lost analysis | [scoring.md](scoring.md) |
| Source discovery before spending, public datasets, buyer language | [research.md](research.md) |
| One account: its decision makers, the context and a 3-step sequence ("find decision makers at X and write the sequence") | [recipes/account-to-sequence.md](recipes/account-to-sequence.md) |
| Qualification, sequences, personalization | [writing-outreach.md](writing-outreach.md) |
| An upcoming trade show, conference or dinner: who will be there, who to meet, top 5 and briefs | the `event-brief` skill, `skills/event-brief/SKILL.md` |
| LinkedIn buying signals, competitor engagement, tracked people | [recipes/linkedin-signals.md](recipes/linkedin-signals.md), `provider-playbooks/harvestapi.md` |
| Scheduling, cron, alerts, "how do we get pinged" | [references/scheduling.md](references/scheduling.md) |
| Provider pricing, payloads, pitfalls | `provider-playbooks/<provider>.md` (18 files) |
| Tables, columns, RGPD | [references/schema.md](references/schema.md) |
| Which statuses are sendable | [references/email-status-policy.md](references/email-status-policy.md) |
| Reading a receipt | [references/cost-receipt.md](references/cost-receipt.md) |
| Golden records, accuracy audit | [references/contact-accuracy.md](references/contact-accuracy.md) |

`agents/execution-plan-creator.md` produces a plan (goal, governing docs, pilot vs full-run steps, approval gate, risks) without running anything.

## Policy

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
