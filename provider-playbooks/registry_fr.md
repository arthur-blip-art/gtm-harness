# French registries (Recherche d'entreprises, BODACC) — agent guidance

**Best for:** French accounts at zero cost: every active company by NAF code, department and headcount band, with its legal officers (the CEO and founders of a 20-to-200 person SaaS), then its legal events (capital changes, officer changes, new establishments).

**Operations (adapter `src/providers/registry-fr.ts`, provider name `registry_fr`, no key):**
- `search_companies` — `GET https://recherche-entreprises.api.gouv.fr/search` with `activite_principale` (NAF), `departement`, `tranche_effectif_salarie`, `q`, `etat_administratif=A` → `{companies[{siren,name,naf,headcount_band,created_at,city,postal_code,officers[{first_name,last_name,role}]}], total}`.
- `bodacc_events` — BODACC on opendatasoft, `registre like "<siren>"` → `{events[{published_at,family,kind,detail,url}]}`.

**SaaS NAF codes:** 58.29C (software publishing), 58.29A, 58.29B, 62.01Z (programming), 63.11Z (data processing, hosting), 62.02A (IT consulting).

**Pricing basis:** free. Rate limit ~7 req/s on Recherche d'entreprises. Verified on: 2026-10-08 (field names to verify against the docs).

**Pitfalls:**
- No website field: `icp-to-companies` resolves each name to a domain with one Serper query (~$0.001), skipping directories (`core/resolve-domain.ts`).
- Officers are legal roles (Président, DG, Gérant): right for the top of a small company, wrong for "Head of Sales". `company-to-people` uses them only when the titles ask for executives.
- A BODACC capital change can be a decrease: the signal says "check the direction".
