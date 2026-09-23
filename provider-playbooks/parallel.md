# Parallel — agent guidance

**Best for:** managed research and extraction for account briefs (phase 2: `run_task` with a schema, cited URLs).

**Operations (adapter `src/providers/parallel.ts`):**
- `search` — `POST /v1beta/search` `{objective, max_results}` → `results[{url,title,excerpts}]`. Skeleton in the MVP.

**Pricing basis:** per_call, estimate 0.1 credit; `run_task` pricing depends on processor tier.

**Pitfalls:**
- Slower and lower precision than Exa for simple lookups; use it for synthesis, not for domain resolution.
- `run_task` may return pending: keep the `run_id` and poll.
