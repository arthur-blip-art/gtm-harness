# Finding companies and contacts (phase 2, not built yet)

This engine does not yet source rows. Planned plays: `icp-to-companies` (Apollo `mixed_companies/search`, Crustdata company search with the `limit:1` sizing trick) and `company-to-persona` (Apollo `mixed_people/search`), companies first, then people.

Until then, build seed lists with the tools already connected to Claude (Apollo export, FullEnrich people search, Gojiberry, Deepline `/deepline-gtm`), keep source lineage in a `source` column, and hand the CSV to `enriching-and-researching.md`.

Rules that will apply, copied from Deepline: companies first, then people; never start with broad people searches; `limit:1` to size before buying; stop at ~80% coverage; over-provision 1.4×N.
