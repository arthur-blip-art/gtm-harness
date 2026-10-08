# Recipe: find the right people and prepare sequences (the button)

Use when the user asks for prospects end to end: "trouve-moi des décideurs et prépare des séquences", "lead gen sur ce
segment", "find me VP Sales at French SaaS and write the emails", "qui appeler cette semaine". Also when a signal should
turn into outreach on its own ("dès qu'une boîte lève, prépare-moi un mail").

Two entry points, same cascade:

| entry | trigger | play |
|---|---|---|
| an ICP | the user, the GitHub Actions button (`prospect` workflow), or `gtm run prospect` | `prospect` |
| a signal | the weekday cron (`signals-to-action` workflow) after `linkedin-signals` and `social-listening` | `signal-to-action` |

## The cascade, cheapest source first

| step | free first | then cheap | then paid, only for what is missing |
|---|---|---|---|
| accounts | lookalikes of `seed_domains` (Exa find_similar, ~$0.005), FR registry by NAF + headcount band (free) | domain resolution by Serper (~$0.001) | Apollo, TheirStack, Crustdata, sized with limit:1 first |
| situation + timing | own ATS board (jobs), Google News RSS (funding, new exec, launch), SEC Form D, BODACC | Serper News when RSS is empty | PredictLeads, TheirStack, Crustdata (`paid_signals`: never by default) |
| ranking | timing score from fresh signals (weights in `core/signal-rules.ts`), then account fit | | |
| right people | legal officers (FR registry) for CEO-level asks | Google dork `site:linkedin.com/in "<title>" "<company>"` (~$0.001) | FullEnrich search, Apollo, Prospeo |
| email | pattern + MillionVerifier | Hunter, LeadMagic, Findymail, Prospeo, Apollo | FullEnrich, Crustdata, PDL, then verification |
| context | website pages, DNS, stack fingerprint, job ads, news | Maps switchboard via Serper (~$0.003) | ScrapeGraph render only for JS-only sites |
| judgment | | one LLM call per account (brief) and per draft | |

## Run it

```bash
cp config/prospect.example.json config/prospect.json      # edit ICP, titles, offer, sender, language
gtm run prospect --input @config/prospect.json --dry-run  # rehearsal, no keys, no spend
gtm run prospect --input @config/prospect.json --max-credits 30
```

Output in `out_dir` (default `gtm-data/prospect-<date>/`): `README.md` (one table: account, timing, signals, why now,
draft link), `accounts.csv`, `people.csv` (sequencer import), `accounts/<domain>.md` (one-page brief),
`sequences/<domain>--<person>.md` (3 steps, the audit, the list of what to check).

## Where a human decides, and only there

1. **Once, at setup**: the ICP, the personas in order, the offer (what we sell, one proof, the step-1 resource). These
   are in the config file; the agent asks for them if missing, never invents them.
2. **Before spending past the cap**: `--max-credits` aborts; the gate hook asks before any paid full run.
3. **Before anything leaves the building**: every draft is `draft` or `needs_review` with the exact reasons (fact past
   its shelf life, claim with an unread source, email not HIGH/MEDIUM, a copy-audit check failed). Nothing is sent and
   nothing is pushed to a CRM by default (`sync_hubspot: false`): wiring the sequencer and the CRM stays each company's
   choice.

Everything between those points (which source to call, which fact opens the email, which person to pick) is decided by
the cascade and the LLM step inside the plays, and logged in the cost receipt and the brief.

## After the run

Show the README table, then the receipt line (credits, accepted), then the drafts that need review with their reasons.
Recommend one change (a persona that never resolves, a source that is a CUT CANDIDATE) rather than a list.
