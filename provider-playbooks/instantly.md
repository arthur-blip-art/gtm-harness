# Instantly — agent guidance

**Best for:** sending the sequences that `account-to-sequence` writes. The harness creates campaigns as **drafts** and adds leads; activation stays a human click in Instantly.

**Operations (adapter `src/providers/instantly.ts`, Bearer `INSTANTLY_API_KEY`, API v2; every tool is `noCache: true`):**
- `create_campaign` — `POST /api/v2/campaigns` `{name, campaign_schedule, sequences[{steps}]}` → `{id, status: 0}` (draft). Steps carry subject, body and `delay_days`.
- `add_leads` — `POST /api/v2/leads/add` `{campaign_id, skip_if_in_workspace: true, leads[]}` (≤ 1,000) → uploaded / skipped counts. Personalization goes in `custom_variables`.
- `campaign_analytics` — `GET /api/v2/campaigns/analytics?ids=` → sent, replied, bounced, opportunities per campaign.
- `step_analytics` — `GET /api/v2/campaigns/analytics/steps?campaign_id=` → per step and variant.

**Pricing basis:** free per call (plan-based). Verified on: 2026-10-13, endpoints marked `verify against docs`.

**Pitfalls:**
- Never activate from the harness: `push-sequencer` only creates drafts, and the approval hook asks before any non-dry run.
- Only HIGH/MEDIUM emails go in; `suppress` runs first (open deal, customer, partner, touched < 84 days, opt-out).
- Opens are unreliable (Apple MPP): `campaign-report` ranks by replies and opportunities, never by opens.
