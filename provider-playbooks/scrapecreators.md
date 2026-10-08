# ScrapeCreators — agent guidance

**Best for:** public social data behind one key, pay-as-you-go credits that never expire: Reddit threads and X posts for social listening (what HarvestAPI does not cover). It also has LinkedIn, TikTok, Instagram, YouTube and ad-library endpoints (see https://docs.scrapecreators.com/openapi.json).

**Operations (adapter `src/providers/scrapecreators.ts`, header `x-api-key`, env `SCRAPECREATORS_API_KEY`):**
- `reddit_search` — `GET /v1/reddit/search?query&sort&timeframe` → `{posts[{title,url,subreddit,score,comments,created_at,text}]}`.
- `twitter_user_tweets` — `GET /v1/twitter/user-tweets?handle` → `{tweets[{text,url,created_at,likes}]}`.

**Pricing basis:** per_call 0.02 credit (~1 ScrapeCreators credit, ~$0.002 on the larger packs; 100 free credits at signup). Some endpoints cost more (e.g. ~26 credits for TikTok audience). Verified on: estimate 2026-10-08, verify against docs.

**Pitfalls:**
- Response shapes differ by endpoint and version: the adapter maps defensively; check one raw receipt before a large run.
- Use HarvestAPI for LinkedIn posts and engagers (cheaper per item, richer); ScrapeCreators LinkedIn endpoints are a fallback.
