---
name: revive-closed-lost
description: "Pick 5 closed-lost deals where something changed since the loss, write a re-engagement sequence whose angle is the loss reason, suppress, push as a draft."
---

# Revive closed-lost: 5 deals, the loss reason as the angle

A lost deal is the warmest cold account: they had the need, we know why it stopped. Write again only when something
changed since. Inspired by retriever.run `re-engagement` (coldiq), `bridgebound-history-16` (coldiq),
`customer-win-back-sequencer` (gooses).

## When to use

- "Relance les deals perdus", "quels closed-lost reprendre ce trimestre ?", "on a perdu X contre Codat il y a 6 mois"
- "Revive closed-lost deals", "win back the demos that went dark", "re-engage lost opportunities"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Mass "just checking in" to every lost deal | Low replies, unsubscribes, burnt contacts | Write only where something changed (signal, new person, our product); 5 deals, not 50 |
| Ignore the loss reason | Same pitch, same no | The reason is the angle: price → a smaller start; timing → their new trigger; competitor → what changed there |
| Re-open under 60 days | Feels like pressure | `min_days_since_loss: 60` minimum; 90+ for "chose a competitor" |
| Write to the person who said no, only | They defend their decision | Add the new decision maker if one arrived since; the original contact gets a lighter note |
| Rubbish the competitor they chose | Defensive reply or none | State our change and their situation; see `recipes/competitor-displacement.md`, "What not to say" |
| Skip `suppress` | A revived deal already reopened by an AE gets a sequence | `suppress` drops open deals and recent touches |

## Steps

### Step 1: list the lost deals — [search]

```bash
gtm run closed-lost-revival --input '{"min_days_since_loss":60}' --dry-run
gtm run closed-lost-revival --input '{"min_days_since_loss":60}'
```

**Output:** deals lost > 60 days, loss reason, competitor named, contacts, plus what changed since the loss
(new funding, new CTO/CPO, integrations job ad, new country, integrations page changed).
**Checkpoint:** every row has a loss reason; "unknown" rows go to the AE for a one-line answer, not into a sequence.

### Step 2: choose 5 — [transform]

Rank by: a change since the loss (required) > deal size > fit grade (`score-accounts`). Keep 5. Write one line each:
loss reason, what changed (with source and date), who to write to.
**Checkpoint:** if fewer than 5 have a real change, send fewer. Zero is a valid answer.

### Step 3: the angle — [compose]

Run `account-pains` on each of the 5, with the loss reason and the change as input. Then pick the angle:

| Loss reason | Angle for step 1 | Example first line |
|---|---|---|
| Timing / not a priority | Their new trigger | "You opened Germany in June: DATEV is the first question German accountants ask." |
| Price / budget | Smaller start, cost of the build since | "Since March you've posted two backend roles for integrations. One connector in-house is 22–44k before maintenance." |
| Chose a competitor | What changed on our side, factually (coverage in their country) | "When we spoke, we had no Cegid Quadra connector. We do now." (only if true today) |
| Build in-house | The maintenance line, now real | "Your team shipped the Exact connector last year. How many tickets has it cost since?" |
| No decision / went dark | The new person, or a direct close | "You're new as CPO; your predecessor and I looked at accounting coverage last spring." |
| Missing ledger / country | The connector now exists | Only if the ledger is live in Chift's catalog today (check chift.eu/integrations) |

### Step 4: write the re-engagement sequence — [compose]

**When the call where the deal was lost is recorded** (Allo: `allo_search_conversation_items` by company, then
`allo_get_conversation_item`), use the `closed-lost-reactivation` skill instead of the table above: it pulls the real
loss reason as the prospect said it, their own condition ("come back when…"), one detail only someone on the call
would know, and shapes the ask around it. The CRM loss reason alone is the fallback, never the first choice.


`cold-outreach` skill, WRITE mode, with "re-engagement" as context: 3 steps (D0, D5, D12), shorter than a cold
sequence (step 1 ≤ 90 words), first line = the change, one mention of the past conversation, no guilt ("we haven't
heard from you"). Then AUDIT mode (8 checks, Swap Test, source check). Write to
`gtm-data/sequences/revival-YYYY-MM/<domain>.md`.

### Step 5: suppress — [transform]

```bash
gtm run suppress --input @gtm-data/sequences/revival-YYYY-MM/people.json --dry-run
gtm run suppress --input @gtm-data/sequences/revival-YYYY-MM/people.json
```

`people.json` = `{"people":[{"email":"…","domain":"…"}],"cooldown_days":84}`.
**Checkpoint:** dropped rows have a reason; an `open_deal` drop means an AE already reopened it: tell them.

### Step 6: push as a draft — [deliver]

```bash
gtm run push-sequencer --input @gtm-data/sequences/revival-YYYY-MM/campaign.json --dry-run
gtm run push-sequencer --input @gtm-data/sequences/revival-YYYY-MM/campaign.json      # gate asks; draft only
```

`campaign.json` = `{"campaign":"revival-YYYY-MM","steps":[…],"leads":[…kept rows…],"dry_run_only":true}`.
Activation is a human click in Instantly after the AE reads each lead. Log the revival as a HubSpot task on the deal.

## Cost

`closed-lost-revival`, `suppress`, `push-sequencer`: free (HubSpot, Instantly). The change detection uses
`company-signals` legs on cache miss (cents). New decision maker lookup: `company-to-people` + email waterfall,
price-on-hit, ~0.5–1 credit per new contact found.

## Output

`gtm-data/sequences/revival-YYYY-MM/` (one file per account, `people.json`, `campaign.json`), a draft campaign in
Instantly, a task per deal in HubSpot. `campaign-report` at D+7 (see `recipes/outbound-launch.md`).
