# LLM (Anthropic Messages API) — agent guidance

**Best for:** the judgment steps inside the plays, so they run unattended: read a company's pages and say what it sells and why now; pick angles; draft a sequence. Structured outputs only: every call has a JSON schema, so plays read fields, never prose.

**Operations (adapter `src/providers/llm.ts`, `@anthropic-ai/sdk`, env `ANTHROPIC_API_KEY`):**
- `generate` — `{task, system, prompt, schema, effort?, model?}` → `{task, model, result, usage}`. Server-side fallback on a policy refusal (`fallbacks: "default"`) except on Haiku.

**Model and price:** `GTM_LLM_MODEL`, default `claude-opus-5-5` at `low` effort ($4 / $20 per MTok). The cheapest option for extraction and short copy is `claude-haiku-5-5` ($0.10 / $0.50 per MTok): set it in `.env` after checking a few briefs. Cost is exact, from the usage the API returns: 1 credit = $0.01. Verified on: 2026-10-06 (Anthropic list prices).

**Pricing basis:** per_call, exact cost from token usage.

**Pitfalls:**
- The model only sees the facts the play gives it, each with its source URL; angles whose URL was not read are dropped, and a draft that cites an unread URL goes to review.
- Without `ANTHROPIC_API_KEY` the plays still run: `account-context` returns facts and a rules-based summary, `draft-sequence` a template flagged for rewrite.
- Cached by (task, model, prompt, schema): a rerun on unchanged facts costs nothing.
