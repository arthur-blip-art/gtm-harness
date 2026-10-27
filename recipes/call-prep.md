---
name: call-prep
description: "One-page brief before a discovery or partner call: HubSpot history, company facts, tech, coverage gap, attendees, pains, persona questions for Chift, and the qualification checklist for the end of the call."
---

# Call prep: one page before a discovery or partner call

Twenty minutes of preparation, one page out, read in two minutes before the call. Inspired by retriever.run
`sales-call-prep` (gooses), `persona-intel` (gtmage), `discovery-calls` (gtmage).

## When to use

- "Prépare mon call de demain avec Acme", "brief avant la démo avec le CTO de X", "qui sont les participants ?"
- "Quelles questions poser au Head of Partnerships de Y ?"
- "Prep me for my call with acme.io", "one-pager before the discovery call", "what should I ask their CPO?"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| A 4-page dossier | Nobody reads it before the call | One page; everything else in the appendix file |
| Facts without source or date | You quote a 2023 round as "recent" | Every line in the brief carries a URL and a date |
| Asking what the website already says | "So what does Acme do?" | Questions start from what we read ("you list Xero and Exact, nothing for DATEV: is Germany on the roadmap?") |
| Pitching Chift in the first 10 minutes | Prospect goes defensive, no pain surfaced | Discovery first: 70 % them talking; the demo is earned |
| Paying for every attendee profile on a 6-person invite | Credits on assistants and interns | Profile the 1–3 decision makers; the rest by title only |
| Leaving the call without a next step in the calendar | Deal stalls | Section 6 of the brief: no call ends without a dated next step |

## Steps

### Step 1: HubSpot history — [search]

Company, contacts, deals, last emails and notes, who on our side has talked to them. Read with the HubSpot MCP
(`search_crm_objects` on the domain) or the CLI:

```bash
gtm run sync-hubspot --input '{"domains":["acme.io"],"dry_run":true}' --dry-run
```

**Output:** lifecycle stage, open/closed deals with loss reason, last 3 touches, inbound source.
**Checkpoint:** a customer → CSM call, not discovery; a competitor → stop.

### Step 2: company facts, signals, tech — [enrich]

```bash
gtm run company-enrich  --input '{"domain":"acme.io"}' --dry-run && gtm run company-enrich  --input '{"domain":"acme.io"}'
gtm run company-signals --input '{"domain":"acme.io"}' --dry-run && gtm run company-signals --input '{"domain":"acme.io"}'
gtm run company-tech    --input '{"domain":"acme.io"}' --dry-run && gtm run company-tech    --input '{"domain":"acme.io"}'
```

**Output:** size, countries, funding, open roles (integrations, partnerships, backend), stack hints,
`competitor_detected` (Codat, Merge, Apideck, Rutter SDK or script on the site).
**Checkpoint:** signals older than their shelf life (funding 6 months, new exec 90 days) are context, not a hook.

### Step 3: accounting coverage benchmark — [enrich]

```bash
node scripts/integrations-signal.mjs --domain acme.io --countries FR,BE,NL,DE,ES
cd ../chift-benchmark && npx tsx collector/scenarios.ts acme.io:FR,BE,NL
```

**Output:** ledgers they list, gap per country, competitors that reach what they don't.
**Checkpoint:** open `integrations_page_url` and confirm it is the list page, not a single-ledger page.

### Step 4: attendees — [enrich]

From the invite; if names are missing, find the likely ones:

```bash
gtm run company-to-people --input '{"domain":"acme.io","titles":["CTO","CPO","Head of Partnerships","VP Engineering"],"limit":5}' --dry-run
gtm run person-to-linkedin --input '{"first_name":"Jane","last_name":"Doe","domain":"acme.io"}'
gtm run linkedin-signals --input '{"profiles":["https://www.linkedin.com/in/janedoe"],"posted_limit":"month"}' --dry-run
```

**Output:** per attendee: title, time in role, previous company (an ex-Pleo/Qonto/Sellsy is a warm reference),
last posts on integrations, accounting, e-invoicing.
**Checkpoint:** person-to-linkedin passes the name gate; otherwise "profile not confirmed" in the brief.

### Step 5: pains and angle — [compose]

Run the `account-pains` skill on the domain with steps 2–4 as input. Keep the top 3 pains, each tied to a sourced
signal. Read `gtm-data/voice-of-market.md` (see `recipes/voice-of-market.md`) for the objections this segment raises.

### Step 6: write the brief — [deliver]

Write `gtm-data/calls/<domain>-YYYY-MM-DD.md` with the template below. Show it in the reply.

## Brief template (one page)

```markdown
# <Company> — <discovery | partner> call, <date>, <attendees>
**Why this call:** <inbound form / reply to step 2 / event>, <date>. **Goal:** <what a good outcome is>.
## 1. The account (sourced)
- What they sell, to whom, countries — <url>
- Size, funding, last round <date> — <url>
- Integrations page: <ledgers listed> — <url>; gap: <country: ledger…>
- Competitor or build: <competitor_detected | "in-house connectors, N job ads"> — <url>
- Timing signal: <signal, date> or "none found"
## 2. History with us
<deals, loss reason, last touches, who talked to them>
## 3. Attendees
| Name | Title, since | What they care about | Last post / signal |
## 4. Top 3 pains → hypothesis to test
1. <pain> — signal: <…> — question to confirm: <…>
## 5. Questions (from the bank below, 6 max, adapted with their facts)
## 6. Close: next step to propose, <who, what, date>; qualification checklist below
## Traps
<what not to say: a gap we did not read, a country Chift does not cover, a price>
```

## Discovery question bank (pick 6, rewrite with their facts)

**CTO / VP Engineering**
- "How many accounting integrations do you maintain today, and who owns them when a ledger changes its API?"
- "Last connector you built: how long from spec to the first customer live?" (Chift reference: 12–16 weeks at Pleo)
- "Build vs buy: what would make you keep building in-house?" (listen for control, data model, cost per call)
- "Which ledgers come back most in support tickets?"
- "How do you handle on-premise ledgers (Sage 100, Cegid Quadra, EBP)?"

**CPO / Head of Product**
- "Which accounting software do prospects ask for in demos that you don't have?"
- "Where are integrations on the roadmap against the core product this year?"
- "Next country on the roadmap, and what is the accounting landscape there?"
- "E-invoicing: France's reform (reception mandatory since September 2026) and Peppol in Belgium since January
  2026: is it a roadmap item, a customer question, or handled by a partner?"

**Head of Partnerships / Integrations**
- "How do you pick which ledger to integrate next: requests, partner programme, deals lost?"
- "Do you list on the ledgers' marketplaces (DATEV, Exact, Pennylane)? What do they require?"
- "How many deals last quarter stalled on a missing integration?"
- "Who signs off a new integration partner on your side?"

**CEO of a small vendor (< 50 people)**
- "Who decides here when a customer asks for a ledger you don't have: you, or the CTO?"
- "If your two developers spend a quarter on connectors, what doesn't ship?"
- "Which country do you want to open next, and when?"
- "What did the last lost deal on integrations cost you?"

**Head of Finance at a SaaS (often the economic buyer or a user of the sync)**
- "How does your customers' data reach their accountant today: export, integration, manual entry?"
- "What does a broken sync cost you in support and churn?"
- "How are integration costs budgeted: R&D headcount or a vendor line?"
- "Any customer contract that requires a given ledger or e-invoicing compliance?"

## Qualification at the end of the call (fill before leaving the room)

| Criterion | Yes / No / Unknown | Evidence |
|---|---|---|
| Accounting integration need stated by them (not by us) | | |
| Quantified: ledgers missing, countries, deals lost, weeks of dev | | |
| Build in-house is the alternative, or a competitor is in play (which) | | |
| Champion identified (will sell it internally) | | |
| Economic buyer named | | |
| Timeline driver (country launch, e-invoicing date, funding plan) | | |
| Next step dated in the calendar | | |

3 Unknowns or more → the next call is a second discovery, not a demo. Log the table as a HubSpot note.

## Cost

HubSpot, `integrations-signal`, benchmark, `company-tech`: free. `company-enrich`, `company-signals`: cents on
cache miss. `person-to-linkedin` ~0.01 (serper); `linkedin-signals` profile pull ~0.04 per profile
(harvestapi `get_profile`). A typical brief: under 0.3 credit.

## Output

`gtm-data/calls/<domain>-YYYY-MM-DD.md` (brief) and a HubSpot note with the qualification table after the call.
