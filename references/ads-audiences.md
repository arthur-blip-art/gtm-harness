# Paid-ads audiences (knowledge only)

No ad-platform connector exists in this engine (reference notes under `vendor/deepline-shared/`); `vendor/deepline-shared/audience-hash.ts` is a pure helper (SHA-256, email normalisation, upload rows) reusable as is.

- Upload file shape: `email,phone,fn,ln,country`; email and phone hashed once with SHA-256, lowercase, 64 hex chars. Never double-hash a provider hash.
- The identifier ladder is a waterfall: first-party data → personal-email hash providers (Aviato, LimaData) → ContactOut hashed identifiers (batches of 5–100, billed on `matches_found`) → expanded raw personal-email waterfall only with approval.
- Order by what a miss costs: per-call providers before per-result ones only when hit rate is proven. Measured on a 5,549-row list: LimaData 27.5% / $49.70, ContactOut 53.0% / $52.64, LeadMagic 5.4% / $4.76.
- Always ask for the suppression list (customers, open opps, employees) and enrich it with the same ladder, or it suppresses nobody.
- Expect uneven lift: Meta gains most from personal emails; Google often matches on Workspace addresses already.
