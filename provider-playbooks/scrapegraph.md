# ScrapeGraphAI — agent guidance

**Best for:** an LLM scraper as a service: give a URL and a prompt (optionally a JSON schema), it renders the page, JavaScript included, and returns structured JSON. Here: the fallback when our own fetch gets an empty single-page app.

**Operations (adapter `src/providers/scrapegraph.ts`, header `SGAI-APIKEY`, env `SCRAPEGRAPH_API_KEY`):**
- `smartscraper` — `POST https://api.scrapegraphai.com/v1/smartscraper {website_url, user_prompt, output_schema?}` → `{url, result}`.

**Pricing basis:** per_call 0.5 credit (~5 to 10 ScrapeGraph credits per page, ~$0.02-0.05 depending on the plan; 500 free credits/month on the free plan). Verified on: estimate 2026-10-08, verify against docs.

**Pitfalls:**
- It is an LLM: treat the result as extraction, not as a source. Cite the page URL, never "ScrapeGraph".
- Use our own `web.fetch_page` + `llm.generate` first: it is free for the fetch and cheaper for the extraction. ScrapeGraph earns its price only on JS-rendered pages.
