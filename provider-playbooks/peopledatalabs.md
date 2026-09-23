# People Data Labs — agent guidance

**Best for:** last-resort person enrichment with broad coverage; also company enrichment and job-change data in phase 2.

**Operations (adapter `src/providers/peopledatalabs.ts`):**
- `person_enrich` — `GET /v5/person/enrich` with `first_name`, `last_name`, `company=<domain>` (or `profile=<linkedin_url>`), `required=work_email`, `min_likelihood=6`.

**Pricing basis:** per_hit; bills on 200 only, 404 is free. The `x-call-credits-spent` header is written to the receipt as the exact cost.

**Pitfalls:**
- Emails are not verified by PDL → canonical `unknown` → HOLD until the verifier pass. Without a verifier key this leg mostly produces HOLD rows: consider disabling it (`--legs`).
- Expensive per hit; keep it last and watch for `CUT CANDIDATE`.
- `min_likelihood` below 6 increases wrong-person risk.
