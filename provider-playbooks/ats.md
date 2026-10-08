# ATS public job boards — agent guidance

**Best for:** the hiring signal of a B2B SaaS, free and first-hand: the open roles on the company's own board, with the job text (tools named in job ads feed the tech fingerprint). The paid job APIs (TheirStack, PredictLeads) scrape the same boards.

**Operations (adapter `src/providers/ats.ts`, no key):**
- `greenhouse_jobs` — `GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true`
- `lever_jobs` — `GET https://api.lever.co/v0/postings/{board}?mode=json`
- `ashby_jobs` — `GET https://api.ashbyhq.com/posting-api/job-board/{board}`
- `workable_jobs` — `GET https://apply.workable.com/api/v1/widget/accounts/{board}`
- `recruitee_jobs` — `GET https://{board}.recruitee.com/api/offers/`
All return `{ats, board, jobs[{title,url,location,department,posted_at,text?}], count}`; `miss` with `board_not_found` or `no_open_jobs`.

**Pricing basis:** free. Verified on: 2026-10-08 (endpoints to verify against each ATS's docs).

**Pitfalls:**
- The board slug comes from the careers page links (`core/discover.ts`): never guess it from the domain, a wrong slug can be another company's board.
- Welcome to the Jungle, Teamtailor, Personio and SmartRecruiters have no adapter yet: their boards fall back to the paid job APIs in `company-signals` (`paid: "gap"`).
