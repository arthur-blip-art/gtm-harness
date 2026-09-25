# HarvestAPI — agent guidance

**Best for:** LinkedIn data without cookies or an account: keyword post search, company and profile posts, reactions and comments on a post, full profiles, employee search. It is the raw material of "social buying signals" (what Sillage packages) and what agent-first GTM CLIs use for LinkedIn.

**Operations (adapter `src/providers/harvestapi.ts`):**
- `search_posts` {search, postedLimit 24h|week|month, page} → `posts[{post_url, text, posted_at, author_name, author_title, author_linkedin, author_company}]`
- `company_posts` {company URL/slug} · `profile_posts` {profile URL} → same shape
- `post_reactions` / `post_comments` {post URL} → `people[{name, title, linkedin_url, reaction|comment, text}]`
- `get_profile` {url, main:true} → current title, company, location

**Pricing basis:** per_result. Public Apify prices (2026-09): ~$2 per 1k posts, reactions or comments; ~$4 per 1k full profiles; profile search $0.10 per page + $0.004 per profile. The direct API (api.harvestapi.io) is a subscription whose limit is **concurrency**, not calls per minute (a Business plan is typically 40 concurrent requests). Endpoint paths and header in the adapter are marked `verify against docs`.

**Pitfalls:**
- Pull only. Nothing notifies you: schedule the `linkedin-signals` play (`.github/workflows/linkedin-signals.yml`) and diff against the `signals` table.
- `pagination.totalPages: 0` means unknown; a returned `paginationToken` is the only proof another page exists.
- `postedLimit` may return posts outside the window; filter on `posted_at` client-side when the date matters.
- Employee search matches `currentCompanies` by **name**: discard rows whose company id differs from the intended company.
- Sales Navigator URLs are not profiles. Only `/in/` and `/company/` URLs.
- `findEmail` on profiles costs more; leave email discovery to the email waterfall.
- LinkedIn actively fights this collection. Treat coverage as fragile; never build a promise to the sales team on it alone.
