# HubSpot — agent guidance

**Best for:** the system of record: dedupe against existing contacts/companies before enriching, then write enriched fields back. No credits; rate-limited.

**Operations (adapter `src/providers/hubspot.ts`, Bearer `HUBSPOT_TOKEN` private app; every tool is `noCache: true`):**
- `search_objects` — `POST /crm/v3/objects/{objectType}/search {filterGroups:[{filters:[{propertyName, operator:'EQ', value}]}], properties[], limit≤100}` → `{results[{id,properties}], total, objectType}`. Accepts `filters[]` or the shorthand `propertyName/operator/value`.
- `batch_upsert` — `POST /crm/v3/objects/{objectType}/batch/upsert {inputs:[{idProperty, id, properties}]}` (≤100) → `{results[{id,properties,new}], status, errors}`.
- `create` — `POST /crm/v3/objects/{objectType} {properties}` → `{id, properties, objectType}`; 409 → miss `already_exists`.
- `update` — `PATCH /crm/v3/objects/{objectType}/{id} {properties}` → `{id, properties, objectType}`; 404 → miss `not_found`.
- `associate` — `PUT /crm/v4/objects/contacts/{contactId}/associations/default/companies/{companyId}` → `{contactId, companyId, results}`.

**Pricing basis:** free on all tools (0 credits, `usdPerCredit: 0`). Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- CRM state changes between calls: all tools set `noCache: true` (honoured by ToolRunner). Never rely on a receipt for a search result.
- `batch_upsert` needs a **unique** `idProperty`: `email` works for contacts, but `domain` on companies is not unique by default → a 400 means fall back to `search_objects` + `create`/`update`.
- Private-app limits: ~100 requests / 10 s overall and ~4 search requests / s; the runner is sequential and backs off on 429.
- Search is eventually consistent (seconds after a write); do not search-then-create in a tight loop or you will create duplicates — batch the dedupe pass first.
- Only send properties that exist in the portal; unknown property names fail the whole batch with `PROPERTY_DOESNT_EXIST`.
