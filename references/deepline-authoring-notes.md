# What we took from Deepline's play runtime, and what we did not

Sources: `vendor/deepline-shared/authoring.md`, `sdk-reference.md`, the 28 bundles in `vendor/deepline-plays/`.

**Taken**
- Order IS the economics: legs run sequentially, cheapest and most precise first; a row never reaches leg N+1 once accepted.
- One paid operation per cell; shaping/projection in separate pure columns (`${field}_result__<leg>` then `${field}`).
- Stable identities: receipts keyed by (provider, tool, sha256(normalized input)); rows keyed by linkedin > email > name+apex, never an index. Renaming an identity is a migration.
- Reruns reuse completed work: our `dataset_rows.cells` + receipt cache ≈ their durable dataset + content-addressed receipts (they measured 0.31 → 0.01 credits on an identical rerun).
- One file exports `scalar` and `batch` sharing a steps factory (`defineRowPlay`), like their `personToEmailSteps()` used by both variants.
- Validation as its own leg after finders (ZeroBounce after each finder in their email play; our single `verify` + `zerobounce` pass on held rows, cheaper).
- A miss is a typed outcome, never null without a reason; the winner is picked by an ordered loop, not `??`.
- External writes carry an idempotency key (`crm_sync.last_hash`).

**Not taken (yet)**
- `runIf` per step with `isProviderUnavailable` swallowing only outages: we record `error` cells and move on for every error type.
- Durable replay of the play body (their `ctx.*` calls replay from history on worker restart): ours resumes from persisted cells and receipts, which covers crashes between legs, not inside one.
- Cron/webhook triggers, `billing.maxCreditsPerRun` on published plays, Slack notifications, cloud execution.
- `search-experiment.ts` (comparison → pilot → holdout → challenge → exploit with a cost/coverage frontier): vendored as reference; a port would sit on top of `ctx.waterfall`.
