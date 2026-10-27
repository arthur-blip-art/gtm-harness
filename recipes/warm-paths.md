---
name: warm-paths
description: "Find the warm paths into a target account (shared investors, shared customers, ledger partners, former colleagues, events) and turn each into one sourced opening line injected into account-to-sequence."
---

# Warm paths: a shared connection before a cold first line

A cold email that names a real shared connection gets read. This recipe looks for five kinds of path, keeps the
ones that are verifiable, and writes one opening line per path for `recipes/account-to-sequence.md`.
Inspired by retriever.run `bridgebound-relationship-39` (coldiq), `champion-move-outreach` (gooses).

## When to use

- "On a un lien avec Acme ?", "qui peut nous introduire chez X ?", "investisseurs communs avec Chift"
- "Quels comptes du portefeuille de nos VC sont dans l'ICP ?"
- "Any warm intro into acme.io?", "shared investors with Chift", "who do we know there?"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| "We share an investor" as the whole email | Reads as name-dropping, ignored | The path opens; the gap fact still carries the message (rule 1 of account-to-sequence) |
| Ask the investor for 30 intros | Burns the relationship | One ask per quarter per investor, with 2–3 accounts and a forwardable blurb |
| Claim a shared customer you inferred | "You both work with X" is wrong, credibility gone | Only customers listed on both public pages, or both in HubSpot as customers |
| Name a customer without its permission in a cold email | Customer complaint | Public case studies only; otherwise "a payroll vendor in Belgium" |
| Use a former colleague link older than 5 years or a 3-month overlap | "I barely knew him" | Overlap ≥ 1 year, same team or same office |
| Skip `suppress` because "it's warm" | An open deal gets a parallel intro | Warm paths go through `suppress` like everything else |

## Steps

### Step 1: Chift's own graph — [search]

Build once per quarter, reuse:
- **Investors:** `gtm run company-enrich --input '{"domain":"chift.eu"}'` → funding rounds and investors. Keep the
  list in `gtm-data/warm-paths/chift-graph.json` (`investors[]`, `customers[]`, `partners[]`).
- **Customers:** HubSpot companies with lifecycle `customer` (`node scripts/hubspot-domains.mjs` with a customer
  filter, or `../chift-benchmark/data/chift-accounts.json`).
- **Ledger partners:** the ledgers whose marketplace lists Chift (Pennylane, Exact, DATEV…, from chift.eu/integrations).
**Checkpoint:** every investor and partner has a source URL.

### Step 2: shared investors — [search, enrich]

Two directions:
- **Account → investors:** `gtm run company-enrich --input '{"domain":"acme.io"}' --dry-run`, then live; compare
  `funding.investors` with `chift-graph.investors`.
- **Investor → accounts:** the `portfolio-prospecting` skill on each Chift VC: their portfolio, filtered on B2B
  software vendors in FR/BE/NL/DE/ES, then `recipes/find-accounts.md` checks.
**Output:** `investor_path` rows: account, investor, partner name at the fund, source URLs.

### Step 3: shared customers and ledger partners — [enrich]

```bash
node scripts/integrations-signal.mjs --domain acme.io --countries FR,BE,NL
```
- A Chift customer listed on the account's integrations or partner page (e.g. they integrate with a Chift customer)
  → `customer_path`.
- A ledger partner of Chift that the account also lists, or wants (their gap) → `ledger_path` ("Pennylane's
  marketplace lists both of us" is verifiable; check both listings).
**Checkpoint:** open both pages; screenshot or URL in the row.

### Step 4: former colleagues — [search]

```bash
gtm run people-moves --input '{"from_store":true}' --dry-run
gtm run people-moves --input '{"people":[{"linkedin_url":"https://www.linkedin.com/in/janedoe","company":"Pleo","relation":"champion"}]}' --dry-run
```
Two paths: a Chift champion who moved to the target account (strongest), and a decision maker at the target who
worked with a Chift customer's team (overlap ≥ 1 year). Then live without `--dry-run`.
**Output:** `colleague_path` rows: person, from, to, overlap, source.

### Step 4b: your own LinkedIn network — [search]

The `warm-intro-finder` skill on your `Connections.csv` export (LinkedIn → Settings → Data privacy → Get a copy of
your data → Connections). Local script, no provider, no spend:

```bash
python3 ~/.claude/skills/warm-intro-finder/scripts/match.py Connections.csv --profile
python3 ~/.claude/skills/warm-intro-finder/scripts/match.py Connections.csv --target "Billwise"
python3 ~/.claude/skills/warm-intro-finder/scripts/match.py Connections.csv --reverse --min-score 55 --limit 40
```
Read `--profile` first: if most connections are under 12 months old, they came from content, not relationships;
score them as cold. Reverse mode against the account list of `find-accounts` says which targets are already one hop away.
**Output:** `network_path` rows: person, company, position, connected_on, tie_strength, path_relevance.
**Checkpoint:** a path is warm only if you would recognise the person in the street; drop the rest.

### Step 5: events — [search]

The `event-brief` skill on the next 2 events in FR/Benelux (e.g. Accountex, salons e-facture): target accounts on
the speaker or exhibitor list → `event_path` (date, stand, talk).

### Step 6: one opening line per path — [compose]

| Path | Opening line pattern (then the gap fact) |
|---|---|
| Investor | "{{partner}} at {{fund}} backs both of us; they suggested I write about {{gap}}." (only if they did) — otherwise ask the investor for the intro instead |
| Customer | "{{customer}} runs its accounting integrations through Chift, and you list them as a partner." |
| Ledger partner | "We're both on {{ledger}}'s marketplace; you list it for {{country}}, not {{missing ledger}}." |
| Former colleague | "{{champion}} used Chift at {{old company}} and is now at {{account}}" → write to the champion first, not the account |
| Event | "You're speaking at {{event}} on {{date}}; I'll be at stand {{n}}." |

Rank: champion moved > investor intro done > customer > ledger partner > event. Keep the best one per account and
pass it to `recipes/account-to-sequence.md` step 6 as the first line; the gap fact becomes the second paragraph.

### Step 7: suppress, then sequence — [transform]

```bash
gtm run suppress --input @gtm-data/warm-paths/people.json --dry-run && gtm run suppress --input @gtm-data/warm-paths/people.json
```

## Cost

HubSpot, `integrations-signal`, `people-moves` from store: free. `company-enrich` on cache miss: cents.
`people-moves` live profile checks: ~0.04 per profile (harvestapi `get_profile`). `portfolio-prospecting`: per its
own receipt, pilot first. `event-brief`: free to ~0.5 credit.

## Output

`gtm-data/warm-paths/<domain>.md` (paths found with sources, the line chosen), `gtm-data/warm-paths/chift-graph.json`
(reused), the line injected into `gtm-data/sequences/<domain>.md`.
