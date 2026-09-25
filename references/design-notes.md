# Design notes: the play runtime, and what prior art taught us

The harness exists to run GTM plumbing without a platform in the middle (Clay-style UIs resell data and orchestration; we keep both). Two agent-first CLIs shaped the runtime: Deepline (reference material under `vendor/`, private) and Cargo (MIT, see `prior-art-cargo.md`).

**Kept in our runtime**
- Order IS the economics: legs run sequentially, cheapest and most precise first; a row never reaches leg N+1 once accepted.
- One paid operation per cell; shaping/projection in separate pure columns (`${field}_result__<leg>` then `${field}`).
- Stable identities: receipts keyed by (provider, tool, sha256(normalized input)); rows keyed by linkedin > email > name+apex, never an index. Renaming an identity is a migration.
- Reruns reuse completed work: our `dataset_rows.cells` + receipt cache ≈ their durable dataset + content-addressed receipts (a published measurement: 0.31 → 0.01 credits on an identical rerun).
- One file exports `scalar` and `batch` sharing a steps factory (`defineRowPlay`), the same shape both prior-art CLIs converge on.
- Validation as its own leg after finders (a validator leg after finders; our single `verify` + `zerobounce` pass on held rows is cheaper).
- A miss is a typed outcome, never null without a reason; the winner is picked by an ordered loop, not `??`.
- External writes carry an idempotency key (`crm_sync.last_hash`).

**Deliberately not built (yet)**
- Per-step `runIf` that swallows only provider outages: we record `error` cells and move on for every error type.
- Durable replay of the play body on worker restart: ours resumes from persisted cells and receipts, which covers crashes between legs, not inside one.
- Cron/webhook triggers, `billing.maxCreditsPerRun` on published plays, Slack notifications, cloud execution.
- A search-experiment layer (comparison → pilot → holdout → challenge → exploit with a cost/coverage frontier): reference copy under `vendor/`; a port would sit on top of `ctx.waterfall`.
- Workspace-as-code with plan/deploy/drift (Cargo): our schedules are workflow YAML; a typed `config/schedules.ts` + `gtm plan` is the planned middle ground.
