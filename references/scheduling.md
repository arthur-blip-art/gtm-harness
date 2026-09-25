# Scheduling and alerts: how we get "pinged"

No provider calls us. Every signal source in this engine is pull-based; the skill defines the method, a play does the work when woken, and a scheduler wakes it. Alerts are produced by the play itself (`src/core/notify.ts`, Slack incoming webhook), so the scheduler can change without touching anything else.

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **GitHub Actions** (chosen) | `.github/workflows/linkedin-signals.yml`, cron weekdays 06:00 UTC, secrets in the repo | free, logged, survives laptop sleep, `workflow_dispatch` for manual runs | the repo must live on GitHub (private) |
| Claude Code routine | `/schedule` a cloud agent that runs `gtm run …` and reads the results | Claude can summarise and draft replies in the same run | tied to the Claude subscription; needs repo + secrets access |
| launchd on the Mac | local cron | zero setup | only runs while the Mac is on |
| Apify schedule + webhook | Apify runs the HarvestAPI actor on a schedule and POSTs to an endpoint when done | the only true push | needs a public endpoint (e.g. Supabase Edge Function) and a second runtime |

Rules:
- One workflow per play family; `concurrency` prevents overlapping runs.
- Without secrets the job runs in `--dry-run` and stays green: the first real run is a conscious act (add the secrets).
- Alerts carry only ICP matches and at most 10 lines; the full list is in `signals`.
- Every run's receipt is uploaded as an artifact (30 days) so cost drift is visible.

## Cadence and monthly burn

Before scheduling anything paid, state **per-run cost × cadence = monthly burn** in the approval message. Suggested cadences (borrowed from Cargo's published defaults, MIT):

| Signal | Cadence | Why |
|---|---|---|
| LinkedIn keyword / competitor engagement | weekdays | posts age fast; the cache dedupes within a week window |
| Hiring intent (job posts) | daily | short-lived, cheap per company |
| Funding rounds | weekly | rounds are rare; daily scans of 500 accounts would cost 30× for nothing |
| Job changes | every two weeks, on a curated segment | the most expensive signal; monthly on 300 beats weekly on 1,000 |
| Account re-scoring | weekly, only rows never scored or older than 3 months | staleness gate, not a full recompute |
