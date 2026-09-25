# Prior art: Cargo (getcargo.io) — what it is, what we borrow

Read-only analysis (2026-09-25) of the two MIT-licensed repos `getcargohq/cargo-skills` (router + 16 capability skills, hooks, evals) and `getcargohq/gtm-skills` (25 job-shaped skills, 6 "cookbooks"). Cargo is a hosted GTM platform (api.getcargo.io, 138 integrations, 50 credit-billed providers, YC S23, $19.4M Series A). The skills contain no engine: they teach an agent to drive the `cargo-ai` CLI.

## Their model
- **Workspace as code.** `cargo-ai project init` scaffolds a repo; `infra/*.ts` uses `define*` builders (`defineConnector`, `defineModel`, `defineSegment`, `defineWorkflow`, `definePlay`, `defineAgent`, `defineAlert`…). Importing a file is registering it. `plan` diffs offline against state, `deploy` applies in dependency order, `refresh` reports drift, `pull` regenerates code from the live workspace. Secrets: `secret("ENV")` read at deploy, never persisted.
- **Plays react to segment deltas** (`changeKinds: added|updated|removed`) with an optional cron; **tools** are cron/manual workflows. A play ships `isEnabled:false` and `limit:15` until the pilot is approved.
- **Credits on three axes**: per action, 0.01 per node execution, storage. Example prices: email finders 0.5, FullEnrich 1, hosted waterfall contact 2, job change 3, phone 3–7.
- **Approval**: same four-section prose gate as ours, plus a `PreToolUse` hook that auto-allows safe CLI reads and always prompts on deploy/destroy/login/remove (it never denies, never gates spend), plus a runtime `humanReview` node (Slack approve/decline) for destructive CRM writes.
- **Evals**: `evals/routing.jsonl` (prompt → expected skill, core/hard tiers, lexical check in CI + weekly LLM tier), per-cookbook `contract.mjs` asserting the compiled resources (exact set, `isEnabled:false`, `limit 15`, node counts).
- **Signals**: pull on cron (hiring daily, funding weekly, job changes bi-weekly) with an explicit monthly-burn rule (500 accounts × 1 credit daily = 15,000/month "is almost always wrong"); push via ingest endpoints (RB2B, Albacross) and a Sillage connector that writes detections into a model.

## Where we stand
| | Cargo | GTM Harness |
|---|---|---|
| Hosting / data | their cloud, SoR backed by your warehouse | our CLI, our Supabase (EU) |
| Cost | Cargo credits with markup + per-node fee | provider prices, no intermediary |
| Cache & receipt | connector TTL cache; billing metrics | hash cache, marginal receipt with NEVER REACHED / CUT CANDIDATE (stronger) |
| Approval | prose + hook (allow-only) + humanReview node | prose + `--max-credits` soft cap; no hook |
| Workspace as code | full (plan/deploy/state/drift) | plays in TS; schedules in workflow YAML; no plan |
| Evals | routing JSONL + contract.mjs | 40 vitest + dry-run smoke; no routing evals |
| Signals | cron in cloud + delta triggers + push ingest | GitHub Actions cron, pull only |

## Borrow list (ranked)
1. **Enforced approval hook** `.claude/hooks/gtm-gate.sh`: adapt their shell hardening; auto-allow reads and `--dry-run` / `--limit ≤ 3`; return `ask` on full `gtm run` without cap, `sync-hubspot` without `dry_run`, `--refresh`, `supabase db push`.
2. **Play contracts** as vitest: leg order cheapest-first vs `pricing.table`, no phone leg in default chains, HubSpot only HIGH/MEDIUM; an `acceptance.md` per recipe.
3. **Routing evals** `evals/routing.jsonl` + lexical checker in CI for SKILL.md's routing table.
4. **Typed schedule config** `config/schedules.ts` (`play, input, cron, maxCredits, enabled`) generating the workflow YAML, with `gtm plan` printing per-run cost × cadence = monthly burn.
5. **Cadence table + monthly-burn rule** in `references/scheduling.md`.
6. **Staleness gates** on recurring plays (re-pull only when last check older than the interval).
7. **humanReview** for destructive CRM writes if dedup/merge is added; their dedup policy (LinkedIn ID 60 / URL 25 / domain 15, auto-merge ≥ 60).
8. **Signal output contract**: one row per account that fired, signal/date/source/so_what; never merged into the fit score.
9. Cost-discipline details: quote per-call overhead above ~10%; "approval of the sample is not approval of the full run" (ours pre-approves bounded scopes; keep, but say it).
10. **Clay parity method** (`clay-to-cargo`) for porting Chift's Clay tables.
11. **Playbook lint**: prices in `provider-playbooks/*.md` must equal `src/providers/*` tables.

## Not borrowed
Session telemetry hooks (they upload session summaries to Cargo), remote deploy state, hosted `waterfall.*` actions, ingest endpoints, mailboxes, their credit numbers.

## License
Both repos MIT © 2026 Cargo. Anything adapted keeps the notice in `THIRD_PARTY_NOTICES.md`. Unlike `vendor/` (no license), Cargo material may be redistributed.
