# Exa — agent guidance

**Best for:** semantic web search; in the MVP, resolving a company name to its official website. Phase 2: small-startup people search, LinkedIn URL fallback, research contents.

**Operations (adapter `src/providers/exa.ts`):**
- `search` — `POST /search` `{query, numResults, type:'auto'}` → `results[{url,title}]`. The play takes the first result not on a social/directory domain.

**Pricing basis:** per_call, ~$0.005 per search without contents (0.05 credit).

**Pitfalls:**
- Homonyms: "Qonto official website" is fine, "Alpha official website" is not; check resolved domains on the pilot (`domain_resolution` cell).
- Keep `numResults` small; contents cost more than search.
