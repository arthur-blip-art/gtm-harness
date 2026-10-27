# Hacker News — agent guidance

**Best for:** builder chatter about unified APIs and accounting integrations ("Ask HN: Codat vs building it ourselves?"). Cheap early warning, low volume.

**Operations (adapter `src/providers/hackernews.ts`, no key, public Algolia API):**
- `search` — `GET hn.algolia.com/api/v1/search_by_date?query=&numericFilters=created_at_i>{since}` → `hits[{id, type story|comment, title, text, author, url, link, points, created_at}]`.

**Pricing basis:** free. The `since` timestamp is part of the normalized input, so each window is its own cache entry.

**Pitfalls:**
- Usernames are pseudonymous: a hit is a topic signal, rarely an account. Route it to content ideas or to a manual look, not to a sequence.
- Use exact phrases (`"unified accounting api"`) to keep noise down.
