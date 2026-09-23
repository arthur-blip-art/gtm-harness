---
name: gtm
description: "Self-hosted GTM engine: waterfall email enrichment (and later discovery, signals, scoring, HubSpot sync) with our own provider keys (Apollo, FullEnrich, MillionVerifier, PDL, Crustdata, Exa, Parallel) on a Supabase database. Use for: find emails for a CSV, enrich contacts, pilot a provider route, read a cost receipt. Method copied from Deepline; plumbing is ours."
---

# GTM Engine (meta skill)

SKILL.md routes and sets policy. The matching doc supplies the execution contract: read it before running anything.

## CLI

```bash
gtm providers                       # which keys are configured, price basis per tool
gtm plays                           # available plays
gtm csv show --csv in.csv           # shape + detected columns + 2-row sample (never Read a CSV into context)
gtm run name-domain-to-email --csv in.csv --out out.csv --limit 3      # pilot
gtm run name-domain-to-email --csv in.csv --out out.csv                # full run
gtm receipt <run-id>                # frozen cost receipt
gtm cache stats                     # receipt cache totals
gtm audit --csv out.csv             # email/domain consistency (Deepline validator)
gtm db ping                         # proves DATABASE_URL + migrations
```

`gtm` resolves `.env` from `GTM_HOME` (this repo), CSV paths from the current directory. If `gtm` is not on PATH: `node ~/Documents/Corpo/gtm-engine/bin/gtm.mjs …`. Add `--dry-run` to exercise the whole flow with mock providers and no database.

## Routing: read the matching doc first

| When the task involves… | Read | It gives you |
|---|---|---|
| Finding emails, enriching a CSV, waterfall routes, email statuses, HOLD rows, reruns | [enriching-and-researching.md](enriching-and-researching.md) | play contract, leg order, export columns, cache and rerun semantics, post-run validation |
| Step-by-step email enrichment of a CSV | [recipes/name-domain-to-email.md](recipes/name-domain-to-email.md) | inputs/outputs/checkpoints/fallbacks per step, anti-patterns, gotchas |
| Finding companies or people (not yet built) | [finding-companies-and-contacts.md](finding-companies-and-contacts.md) | phase 2 stub: what exists elsewhere in the meantime |
| Outreach copy, scoring rubrics (not yet built) | [writing-outreach.md](writing-outreach.md) | phase 2 stub |
| Provider-specific pricing, payloads, pitfalls | `provider-playbooks/<provider>.md` | one file per provider |
| What each table/column means, RGPD notes | [references/schema.md](references/schema.md) | data dictionary |
| Which email statuses are sendable | [references/email-status-policy.md](references/email-status-policy.md) | canonical statuses, confidence tiers |
| Reading or explaining a receipt | [references/cost-receipt.md](references/cost-receipt.md) | labels, marginal cost rule |
| Golden record rules, accuracy audit | [references/contact-accuracy.md](references/contact-accuracy.md) | precedence, freshness, audit actions |

Before executing a multi-step request, the `agents/execution-plan-creator.md` subagent can produce the plan (goal, governing docs, pilot vs full-run steps, approval gate, risks) without running anything.

## Policy

**Pilot → price → fix → full run.** Every paid run starts with `--limit 3` (or the whole file when it has ≤ 25 rows and the user stated the scope). Read the receipt: per-leg hits, misses, credits. Fix the route (drop or reorder a leg with `--legs`) before scaling. Do not buy the same failure at full scale. **The pilot is never the deliverable**: the task ends when the FULL input has run and the export sits at the exact `--out` path the user asked for.

**Approval gate.** A user-stated bounded scope (“these 30 contacts”, “everyone in this CSV”) is the approval: pilot, then complete the scope, report cost with the result. Stop and ask only when the scope is open-ended, the pilot reveals a problem (low coverage, wrong-person matches, high cost per usable row), or projected spend exceeds a stated budget. The approval message then uses exactly these four headers and ends with `Approve full run?`:

```
## Assumptions
## CSV Preview (ASCII)
## Credits + Scope + Cap
## Approval Question
```

Stay in AWAIT_APPROVAL until the user confirms. `--max-credits` is a soft cap: the run aborts once spend passes it, rows already processed are kept.

**Over-provision, then filter.** For N wanted rows start with ~1.4×N. Coverage is a property of the company, not of effort: drop incomplete rows, never retry misses by hand.

**Prefer price-on-hit.** Legs that bill on success (Apollo, FullEnrich, PDL) can fan out after a pilot; per-call legs (verifier, search) are cheap by design. Never treat an unknown price as zero: the price tables carry a `verifiedOn` date, treat them as estimates until checked against the provider dashboard.

**Cache is the default.** Identical (provider, tool, normalized input) is never bought twice. `--refresh` re-buys deliberately. Reruns of a dataset skip rows that already have a HIGH email.

**Working directory.** Inputs and exports live next to the user's project (e.g. `./gtm-data/<slug>/`), never in /tmp. Never read a large CSV with the Read tool: `gtm csv show`.

**Decision-ready output.** After a run show the real rows (a Markdown table of name, domain, email, status, confidence), then the receipt line (rows in / accepted / credits / marginal credits per accepted), then one concrete recommendation. Keep receipt ids and mechanics out of the summary unless they change scope, cost or risk.

**Personal data.** Work emails only. Never request personal emails or phones in this MVP. `people.do_not_contact` is honoured downstream. See references/schema.md for the RGPD notes.
