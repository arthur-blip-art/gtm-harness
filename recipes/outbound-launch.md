---
name: outbound-launch
description: "From a list to the first sends: find-accounts or icp-to-pipeline, account-pains, cold-outreach, suppress, push-sequencer as a draft, manual activation, campaign-report at D+7, then iterate."
---

# Outbound launch: from the list to the send, and back

The whole wave in one place, with the two human gates (read the copy, click activate). Inspired by retriever.run
`cold-email-outreach` (gooses), `setup-outreach-campaign-smartlead` (gooses), `sequence-performance` (gooses),
`suppression-logic` (gtmage).

## When to use

- "Lance une campagne outbound sur 20 éditeurs RH", "de la liste à l'envoi", "prépare la vague de novembre"
- "Launch an outbound wave", "list to Instantly", "set up the next campaign and report at D+7"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| One template for 100 accounts | Swap Test fails, replies < 1 % | Per-account first line from a sourced fact; segment-level steps 2–3 |
| Skip `suppress` | A customer or an open deal gets cold email | `suppress` runs on every wave, no exception |
| Activate from the harness | Sends go out unread | `push-sequencer` only creates drafts; activation is a human click |
| Push LOW or HOLD emails | Bounces, domain reputation | HIGH and MEDIUM only (`references/email-status-policy.md`) |
| Judge at D+2 | Noise | `campaign-report` at D+7, decisions at ≥ 100 delivered per variant |
| Change 4 things in the next wave | You learn nothing | One variable per iteration |

## Steps

### Step 1: the accounts — [search]

Software vendors with a sourced gap (free): `recipes/find-accounts.md`. Or by ICP filters:

```bash
gtm run icp-to-pipeline --input @gtm-data/waves/YYYY-MM/icp.json --dry-run
gtm run icp-to-companies --input '{"…":"…","size_only":true}'          # size before buying
gtm run icp-to-pipeline --input @gtm-data/waves/YYYY-MM/icp.json --limit 3   # pilot, read the receipt
```

**Checkpoint:** 20–40 accounts per wave, one segment (same proof, same persona line). Over-provision ×1.4.

### Step 2: people and emails — [enrich]

Already done by `icp-to-pipeline`; otherwise `company-to-people` then `name-domain-to-email` per
`recipes/name-domain-to-email.md` (pilot `--limit 3`, then full). **Checkpoint:** 1–2 contacts per account, HIGH or
MEDIUM email.

### Step 3: angle per account — [compose]

`account-pains` per account (top pain + signal), `integrations-signal` for the gap, `recipes/warm-paths.md` when a
path exists, `gtm-data/voice-of-market.md` for wording.

### Step 4: write and audit — [compose]

`cold-outreach` WRITE then AUDIT, with the rules and flow of `recipes/account-to-sequence.md` (step 1 ≤ 120 words,
LinkedIn ≤ 60, steps 2–3 ≤ 150, one number, one reference, opt-out line). Two variants of step 1 maximum (the one
variable tested). Files in `gtm-data/sequences/<wave>/<domain>.md`.
**Checkpoint (human gate 1):** Arthur or the AE reads every step 1 before step 6.

### Step 5: suppress — [transform]

```bash
gtm run suppress --input @gtm-data/waves/YYYY-MM/people.json --dry-run
gtm run suppress --input @gtm-data/waves/YYYY-MM/people.json
```
**Checkpoint:** read the dropped reasons; `open_deal` and `customer` drops go to their owner, not to the bin.

### Step 6: push as a draft — [deliver]

```bash
gtm run push-sequencer --input @gtm-data/waves/YYYY-MM/campaign.json --dry-run
gtm run push-sequencer --input @gtm-data/waves/YYYY-MM/campaign.json          # gate asks; creates a draft
```
`campaign.json` = `{"campaign":"<wave>","steps":[{"subject":"…","body":"…","delay_days":0},…],"leads":[…kept…],"dry_run_only":true}`
with per-lead first lines in `custom_variables`. `sync-hubspot` the contacts (`dry_run: true` first).

### Step 7: activate by hand — [deliver]

**Human gate 2:** in Instantly, open 3 leads in preview (variables rendered, no `{{`), check sending accounts and
schedule (Tue–Thu, 8:00–11:00 recipient time), then click activate. Note the date in `gtm-data/waves/YYYY-MM/log.md`.

### Step 8: report at D+7 — [search]

```bash
gtm run campaign-report --input '{"campaign_ids":["<id>"]}' --dry-run
gtm run campaign-report --input '{"campaign_ids":["<id>"]}'
```
Read: delivered, bounce (> 3 % → pause, audit the list), replies, positive replies, meetings, per step and variant.
Replies → the `reply-handler` skill for each one (classify, then a 3–5 sentence answer in their language; nothing is sent
for you). Positive ones follow `recipes/inbound-triage.md` (answer < 1 h, then `call-prep`); "remove me" → `do_not_contact`
in HubSpot so `suppress` excludes them everywhere; objections → `recipes/voice-of-market.md`.

### Step 9: iterate — [transform]

One change for the next wave, written in the log with the hypothesis: the first-line type, the persona, the segment,
or step 2's proof. Winning step 1s (top 20 % by positive reply) become the reference examples for `cold-outreach`.
Discuss in `recipes/weekly-gtm-review.md`.

## Cost

`find-accounts`, `suppress`, `push-sequencer`, `campaign-report`: free. `icp-to-pipeline`: price-on-hit waterfall,
typically 1–2 credits per accepted contact with email; size first, pilot `--limit 3`. `account-pains` research:
serper ~0.01 per query, exa answer ~0.05. A 30-account wave: ~30–60 credits.

## Output

`gtm-data/waves/YYYY-MM/` (`icp.json`, `people.json`, `campaign.json`, `log.md`), `gtm-data/sequences/<wave>/`,
a draft then active campaign in Instantly, contacts in HubSpot, the D+7 report in the log.
