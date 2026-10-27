---
name: custom-demo
description: "Design a tailored 15-minute demo on the Chift sandbox: which connectors to show from the prospect's customers' ledgers, their stack and their coverage gap, with a minute-by-minute script."
---

# Custom demo: the prospect's own ledgers on the Chift sandbox

A demo that connects the two or three ledgers their customers actually use beats the generic tour. This recipe
picks the connectors and writes the script; the sandbox setup stays manual. Inspired by retriever.run
`demo-builder` (gooses).

## When to use

- "Prépare la démo pour Acme", "quels connecteurs montrer à X ?", "script de démo 15 min"
- "Build a tailored demo for acme.io", "which ledgers should I show their CTO?"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Show 10 connectors | Blur, no memory of any | 2–3 connectors: the one they have, the one they miss, one on-premise or e-invoicing if relevant |
| Demo a ledger Chift doesn't cover live | Broken demo or a promise we can't keep | Check chift.eu/integrations and the sandbox the day before |
| Start with the dashboard | 5 minutes before anything relevant | Start from their use case: "an invoice created in your product lands in the customer's Exact" |
| Same demo for CTO and CPO | CTO wants the API, CPO the time to market | Script variant per persona (step 4) |
| Skip the discovery | Demo answers questions nobody asked | No demo without the call-prep brief and at least one discovery call |

## Steps

### Step 1: inputs — [search]

The call brief from `recipes/call-prep.md` (`gtm-data/calls/<domain>-*.md`). If missing:

```bash
gtm run company-enrich --input '{"domain":"acme.io"}' --dry-run && gtm run company-enrich --input '{"domain":"acme.io"}'
gtm run company-tech   --input '{"domain":"acme.io"}' --dry-run && gtm run company-tech   --input '{"domain":"acme.io"}'
node scripts/integrations-signal.mjs --domain acme.io --countries FR,BE,NL,DE,ES
```

**Output:** what they sell, objects they push or pull (invoices, payments, expenses, journal entries, payroll),
countries, ledgers listed, gap per country, stack (language, competitor SDK).

### Step 2: pick the connectors — [transform]

| Slot | Rule | Example |
|---|---|---|
| 1. Familiar | A ledger they already support, to show parity fast | Xero or Exact Online |
| 2. The gap | The dominant ledger in their main market they don't list | Pennylane (FR), WinBooks or Octopus (BE), DATEV (DE) |
| 3. The hard one (optional) | On-premise or e-invoicing, only if it came up in discovery and Chift covers it today | Sage 100, Cegid Quadra, ACD |

**Checkpoint:** each connector is live in the sandbox; test the flow the day before.

### Step 3: the flow to show — [transform]

Map their product to one Chift flow: expense tool → expense/journal entry push; invoicing → invoice + customer
push, payment status pull; banking/payments → reconciliation; POS/e-commerce → sales journal; HR → payroll entries.
Prepare sample data that looks like theirs (their currency, VAT rates, a customer name from their segment).

### Step 4: the 15-minute script — [compose]

| Min | Part | What happens |
|---|---|---|
| 0–2 | Recap | Their words from discovery: the gap, the countries, the date that matters. Ask "still right?" |
| 2–5 | Connect | End-customer connects ledger 1 (familiar) through the white-label connect flow, in their language |
| 5–9 | The gap | Same API call, ledger 2 (the gap): one unified model, the record appears in the ledger UI |
| 9–11 | Persona cut | CTO: the API call, auth, webhooks, error handling, docs. CPO: time to market, roadmap freed, marketplace listing. Partnerships: ledger partner listings, co-marketing |
| 11–13 | Proof | The Chift customer in their segment (case table in `recipes/account-to-sequence.md`) and the build cost line |
| 13–15 | Next step | Sandbox access for their dev, a technical session with their CTO, a date; never end without one |

Optional slot 3 replaces minutes 9–11 when on-premise or e-invoicing was raised.

### Step 5: write and log — [deliver]

`gtm-data/demos/<domain>.md`: connectors and why, flow, sample data, script, questions to expect (from
`gtm-data/voice-of-market.md` objections). After the demo: HubSpot note with what landed, objections, next step.

## Cost

`integrations-signal`, `company-tech`: free. `company-enrich`: cents on cache miss. Sandbox: free.

## Output

`gtm-data/demos/<domain>.md` and a HubSpot note after the demo.
