---
name: social-selling
description: "Comment before you write: follow target-account people and KOLs with linkedin-signals, leave 1–2 useful comments per account per week, DM after they engage, log it in HubSpot."
---

# Social selling: comment first, DM after engagement

A DM to someone who has seen your name three times under their posts is not cold. This recipe picks the people,
the posts and the comments; the human posts them. Inspired by retriever.run `social-selling` (gtmage),
`kol-discovery` (gooses), `kol-content-monitor` (gooses), `linkedin-engagement` (coldiq).

## When to use

- "Sur quels posts commenter cette semaine ?", "qui sont les KOL de l'intégration comptable en France ?"
- "Prépare-moi des commentaires pour les CTO de mes comptes cibles", "quand envoyer le DM ?"
- "Which posts should I comment on this week?", "find KOLs on e-invoicing", "social selling plan for my 20 accounts"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| "Great post!" / "So true" | Invisible, or flagged as bot | A comment adds a fact, a number, an experience or a question |
| Pitch Chift in the comment | Public, awkward, the author deletes it | No product name, no link in comments, ever |
| DM right after the first comment | Feels like a trap | DM after *their* engagement: a reply to your comment, a like, a profile visit, an accepted invite |
| Comment 10 posts of the same person in a week | Stalker vibe | 1–2 comments per account per week, spread across 2 people max |
| Automate comments | LinkedIn restrictions, reputational risk | The harness drafts; the human edits and posts |
| Follow KOLs for the reach only | Comments under viral posts get lost | KOLs are for learning the topics and being seen by their audience; the targets are the accounts |

## Rules for a useful comment

1. Under 50 words. First sentence carries the point.
2. Adds one of: a specific fact (a date, a number, a country rule), a short experience ("in Belgium, we see…"), a
   precise question the author will want to answer.
3. Grounded in the post: name their point, then add.
4. In the post's language (FR, NL, EN).
5. No link, no product, no "DM me". The profile headline does the selling.
6. Disagree with a fact and a question, never harshly.

## Steps

### Step 1: the watchlist — [transform]

`config/linkedin-signals.chift.json` `profiles[]`: for each of the 20 target accounts (from `recipes/find-accounts.md`
or the current sequence wave), 1–2 decision makers (CTO, CPO, Head of Partnerships, CEO if < 50 people).
URLs from `person-to-linkedin`.
**Checkpoint:** every URL is a `/in/` URL that passed the name gate.

### Step 2: discover the KOLs — [search]

```bash
gtm run linkedin-signals --input '{"keywords":["intégration comptable","facturation électronique","Peppol","API comptable","open accounting"],"posted_limit":"month"}' --dry-run
gtm run market-watch --input '{"keywords":["e-invoicing France","Peppol Belgium","unified accounting API"],"window":"month"}' --dry-run
```

KOL = authors who post on the topic ≥ 2 times a month with engagement from ICP titles: accounting-tech founders,
e-invoicing experts, ledger product leads (Pennylane, Exact, Cegid), SaaS integration leaders. Keep 10: add their
URLs to `profiles[]` and describe them in `gtm-data/social/kols.md` (name, URL, topics, why).

### Step 3: weekly pull — [search]

```bash
gtm run linkedin-signals --input @config/linkedin-signals.chift.json --dry-run
gtm run linkedin-signals --input @config/linkedin-signals.chift.json --max-credits 5
```

(Or let the scheduled run do it: `recipes/linkedin-signals.md` step 4.)
**Output:** `linkedin_tracked_post` signals for the week.

### Step 4: pick and draft — [compose]

Each Monday: per target account, the 1–2 most recent posts where a comment can add something (skip job
announcements and reshares). Draft one comment each with the rules above, using `gtm-data/voice-of-market.md` for
facts. Write `gtm-data/social/YYYY-Www.md`: account, person, post URL, draft, posted (yes/no).
**Checkpoint:** each draft passes rules 1–6.

### Step 5: DM after engagement — [compose]

Trigger: they replied to the comment, liked it, accepted the invite, or visited the profile within 7 days.
DM with `cold-outreach` (LinkedIn DM 1, ≤ 60 words): opens on the conversation thread, then the gap fact from
`integrations-signal`, one offer (the coverage map), no meeting ask.
**Checkpoint:** `suppress` the person first:
`gtm run suppress --input '{"people":[{"linkedin_url":"…","domain":"…"}]}' --dry-run`, then live.

### Step 6: log in HubSpot — [deliver]

Note on the contact: post URL, comment, date, engagement, DM sent. A reply opens a task for the AE. `sync-hubspot`
creates the contact if missing (`--dry-run` first).

## Cost

`linkedin-signals`: cents per weekly run (harvestapi posts); profile check ~0.04 (`get_profile`). `market-watch`:
free (Hacker News, web). Time: 30 min a week for 20 accounts.

## Output

`gtm-data/social/kols.md`, `gtm-data/social/YYYY-Www.md` (weekly plan and log), HubSpot notes.
