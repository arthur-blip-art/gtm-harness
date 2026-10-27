---
name: inbound-triage
description: "Morning inbound pass: tier yesterday's new HubSpot contacts hot / warm / disqualified, prep and answer the hot ones within the hour, route the rest, add the site visitors."
---

# Inbound triage: the morning pass

Every new inbound contact gets a tier, an owner and a next action before 10:00. Hot ones get a human reply in under
an hour; nothing is auto-sent. Inspired by retriever.run `inbound-lead-triage` (gooses), `lead-qualification`
(gtmage), `disqualification-handling` (gooses), `inbound-lead-enrichment` (gooses), `website-visitors` (coldiq).

## When to use

- "Trie les leads inbound d'hier", "qui est chaud ce matin ?", "qui dois-je rappeler aujourd'hui ?"
- "Réponds aux demandes de démo de la nuit", "que faire de ce lead qui n'est pas ICP ?"
- "Triage yesterday's inbound", "which demo requests are worth a call today?", "polite no for this lead"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Run with `write: true` before reading the dry-run | Tiers land in HubSpot on wrong rules, owners get pinged | The tier rules are exploratory; read 10 rows before any write |
| Answer a hot lead with the cold sequence | "Thanks for your interest" + a generic deck, reply after 2 days | Inbound converts on speed and on answering *their* question; reply < 1 h, by hand |
| Disqualify silently | A student or an accounting firm gets no answer, tells peers | Every inbound gets a reply; a no is short, polite and points somewhere useful |
| Treat a competitor or a customer as a lead | Codat employee gets a discovery call; a customer gets an SDR | `inbound-triage` flags them; customers go to the CSM, competitors get no sales follow-up |
| Write cold to a site visitor because "they visited pricing" | Creepy, RGPD exposure | Site visitors are company-level: use them to prioritise accounts, never to say "I saw you on our site" |
| Count a free-mail signup as hot | Gmail address with "test" as company | No company domain = warm at best until the domain is found |

## Steps

### Step 1: dry-run the triage — [search]

**Input:** HubSpot contacts created in the last 24 h (72 h on Monday), or an explicit list.

```bash
gtm run inbound-triage --input '{"since_hours":24}' --dry-run
gtm run inbound-triage --input '{"since_hours":72}' --dry-run          # Monday
gtm run inbound-triage --input '{"contacts":[{"email":"jane@acme.io"}]}' --dry-run
```

**Output:** one row per contact: tier (`hot` / `warm` / `cold` / `disqualified`), reason, company fit, the form or
page that brought them, suggested angle.
**Checkpoint:** row count = new contacts in HubSpot for the window. Read every `hot` reason: it must cite a fact
(demo request, ICP software vendor, pricing page, ≥ 50 people) not a guess.

### Step 2: live run, then write tiers — [enrich, deliver]

```bash
gtm run inbound-triage --input '{"since_hours":24}'                                   # read-only, enriches
gtm run inbound-triage --input '{"since_hours":24,"write":true,"notify":true}'        # gate asks: writes tier + Slack
```

**Output:** tier and reason on the HubSpot contact, one Slack message with the hot list.
**Checkpoint:** receipt credits (company-enrich and person-* legs on cache misses only); no tier written on a
customer, partner or competitor domain.
**Fallback:** HubSpot down → run on `contacts[]` pasted from the export, `write: false`, tier by hand.

### Step 3: hot → call-prep + reply within the hour — [compose]

Hot = asked for a demo or pricing, or a software vendor in the ICP with integration intent stated in the form.
For each: run `recipes/call-prep.md` in its short mode (HubSpot history, `company-enrich`, `integrations-signal`),
then reply by hand from Gmail/HubSpot with a time slot.

Reply template (edit the brackets, never send it as is):

> Subject: Re: {{their subject}}
>
> Hi {{first_name}},
>
> Thanks for reaching out. I read your integrations page: you connect {{ledgers they list}} today, and
> {{one ledger or country that matters to them}} is the one prospects in {{country}} usually ask for.
>
> Happy to show how {{a comparable Chift customer}} handles it through Chift, and to look at your list with you.
> Would {{slot 1}} or {{slot 2}} work for 20 minutes? Your CTO is welcome too.
>
> {{signature}}

Rules: one fact from their page, one proof (from the segment table in `recipes/account-to-sequence.md`), two slots,
no deck attached, no price in writing before the call.
**Checkpoint:** reply sent < 1 h after the triage run; a meeting or a task logged in HubSpot.

### Step 4: warm → nurture — [deliver]

Warm = fit but no stated intent (newsletter, guide download, webinar), or intent without fit confirmed.
Enrol in the HubSpot nurture list for their segment, no sales email. If `company-signals` shows a timing signal
(funding < 6 months, new CTO/CPO < 90 days, integrations job ad), move to `recipes/account-to-sequence.md` instead.

### Step 5: disqualified → polite no or referral — [compose]

Reply within 24 h with one of these, under 60 words, by hand:

**A. Not a software vendor (an SME looking for an accounting tool)**
> Thanks {{first_name}}. Chift is an API for software vendors, so it is not the right tool for {{company}}'s own
> books. Your accountant or {{their ledger}}'s marketplace will have the integrations you need. Good luck with it.

**B. Accounting firm or integrator (potential partner, not a buyer)**
> Thanks {{first_name}}. Chift sells to software vendors, but firms like yours often recommend them to clients.
> {{partner owner}} looks after our partners; may I introduce you?

**C. Too early (pre-product, under 5 people, no accounting need yet)**
> Thanks {{first_name}}. From what you describe, accounting integrations are a few months out for {{company}}. Our
> docs ({{docs link}}) show how it works; write back when the first customer asks for a ledger and we'll scope it.

Log the reason in HubSpot (`disqualification_reason`). Never sequence a disqualified contact.

### Step 6: add the site visitors — [search]

Company-level visits (no person identified) to rank accounts, not to write to them.

```bash
gtm run site-visitors --input @gtm-data/inbound/visits-$(date +%F).json --dry-run
gtm run site-visitors --input @gtm-data/inbound/visits-$(date +%F).json
```

`visits-YYYY-MM-DD.json` = `{"visits":[{"domain":"acme.io","pages":["/pricing","/integrations/datev"],"visits":3}],"min_score":4}`
from the visitor provider export. **Checkpoint:** keep score ≥ 4 (pricing, a connector page, a comparison page).
A kept account already in HubSpot → note on the company; a new one in the ICP → `recipes/account-to-sequence.md`.

## Cost

`inbound-triage`: HubSpot free; company-enrich and person-* legs only on cache misses (typically < 0.5 credit per
new contact). `site-visitors`: free in the harness (the visitor provider is billed by its own plan).
`integrations-signal`: free.

## Output

- HubSpot: tier, reason, owner, next task per contact (after `write: true`).
- `gtm-data/inbound/YYYY-MM-DD.md`: the hot list with the replies sent, warm and disqualified counts, visitors kept.

## Gotchas

| Gotcha | What happens | Fix |
|---|---|---|
| Monday window | Weekend leads missed | `since_hours: 72` on Monday |
| Same person submits twice | Two rows, two replies | Dedupe on email before replying; the triage keeps the latest form |
| Free-mail address | No domain, fit unknown | Look up the company named in the form, then rerun on `contacts[]` |
| Visitor provider maps to an ISP or a coworking | False account | Drop domains of ISPs, coworkings and universities before scoring |
