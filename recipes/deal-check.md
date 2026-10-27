---
name: deal-check
description: "Check an open Chift deal with deal-health and MEDDICC adapted to a unified accounting API (dev hours saved, connector maintenance, time to market, build in-house as competition), then write the next action in HubSpot."
---

# Deal check: MEDDICC on an open Chift deal

Which deals are stuck, and for each: what we know, what's missing, the one next action. Inspired by retriever.run
`meddic-checklist` (gtmage), `deal-review` (gtmage), `deal-quality-model` (gtmage).

## When to use

- "Où en est le deal Acme ?", "quels deals sont bloqués ?", "fais un MEDDIC sur X", "prochaine étape pour Y"
- "Review my pipeline", "MEDDICC this deal", "which deals have no next step?"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Fill MEDDICC from hope | Every box green, deal lost anyway | Each criterion needs evidence: a quote, a note, an email, with date |
| Count "integration is important" as Metrics | No business case at signature | Metrics = numbers *they* gave: weeks, connectors, deals lost, euros |
| Forget build in-house as a competitor | "No competition" on a deal lost to their own team | In-house is the most common competitor for Chift; always assess it |
| Champion = the friendly contact | No one sells it internally | A champion has power and a personal win, and has acted for us (shared a doc, set a meeting) |
| Ten next actions | None happens | One action, one owner, one date, in HubSpot |

## Steps

### Step 1: find the deals that need a check — [search]

```bash
gtm run deal-health --input '{"stale_days":21}' --dry-run
gtm run deal-health --input '{"stale_days":21}'
```

**Output:** open deals with no activity > 21 days, no next step, close date in the past, or stage age above norm.
**Checkpoint:** take the top 5 by amount; a single deal named by the user skips this step.

### Step 2: gather the evidence — [search]

HubSpot deal, notes, emails, contacts, call briefs in `gtm-data/calls/<domain>-*.md`. Refresh the account if the
last brief is > 30 days old: `gtm run company-signals --input '{"domain":"acme.io"}'` and `company-tech`.

### Step 3: score MEDDICC for Chift — [transform]

Each line: `known` / `partial` / `missing`, evidence with date, and the question that closes the gap.

| Letter | For a Chift deal | Evidence looks like | Gap question |
|---|---|---|---|
| **M** Metrics | Dev hours saved (weeks per connector × connectors needed), connector maintenance cost per year, time to market for a country or ledger, deals lost to missing ledgers | "We need 6 ledgers for FR/BE, ~10 weeks each" | "How many weeks did your last connector take, and how many people keep the existing ones alive?" |
| **E** Economic buyer | CTO (R&D budget), CEO under 50 people, sometimes CFO when billed per connection | Met, agreed to the business case | "Who signs a tool that replaces part of the integrations roadmap?" |
| **D** Decision criteria | Ledger coverage in their countries, data model depth (invoices, journal entries, on-premise), sync reliability, security, price model, white-label | Written list or shortlist grid | "What would make you pick one option over building?" |
| **D** Decision process | Tech evaluation (sandbox, API docs), security review, business case, signature | Steps with dates | "After the sandbox test, what happens, and who's involved?" |
| **P** Paper process | DPA, security questionnaire, procurement, legal entity, contract length | Named legal contact, DPA sent | "Who reviews the DPA and how long does it usually take?" |
| **I** Implicate the pain | Cost of not solving it: country launch late, deal lost on a ledger, engineers on maintenance, e-invoicing deadline | A lost deal named, a date at risk | "What happens to the {{country}} launch if the connectors aren't there by {{date}}?" |
| **C** Champion | Head of Product, Partnerships lead or lead dev who wins personally (roadmap freed, launch on time) | Acted for us: shared an internal doc, booked the EB meeting | "What would you need from me to present this internally?" |
| **C** Competition | Build in-house (always), Codat, Merge, Apideck, Rutter, a ledger's own API, do nothing | Named alternative, their view of it | "If you didn't pick an API, who would build it, and what would they stop doing?" |

**Checkpoint:** Metrics and Economic buyer both `missing` past the demo stage = deal at risk: say so.

### Step 4: the one next action — [compose]

Pick the most valuable missing letter (order: I → M → E → Champion → Decision process → P → Decision criteria →
Competition) and write one action: who, what, by when, with which question or asset (the coverage map, the
build-vs-buy cost line of 22–44k per connector, a reference call with a Chift customer in their segment).

### Step 5: write it in HubSpot — [deliver]

Note on the deal: the MEDDICC table (one line per letter, status + evidence), the risk in one sentence, the next
action; a task with the date. HubSpot MCP (`manage_crm_objects`) or the UI. The harness never changes deal stage
or amount.

## Cost

`deal-health`, HubSpot reads: free. Account refresh: cents on cache miss.

## Output

HubSpot note and task per deal; `gtm-data/deals/YYYY-MM-DD.md` with the deals checked (table + next action).
