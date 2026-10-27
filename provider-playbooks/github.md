# GitHub — agent guidance

**Best for:** developer-side buying signals. Chift's buyer is often the engineer who would otherwise build the connectors: who imports a competitor SDK, who stars it, who asks for a missing integration in its issues.

**Operations (adapter `src/providers/github.ts`, `GITHUB_TOKEN`, REST API 2022-11-28):**
- `search_code` — `GET /search/code?q=` → `items[{repo, owner, owner_type, path, url, fork}]`. Typical query: `"@codat/accounting" filename:package.json` or `"merge-api-client" filename:requirements.txt`.
- `search_repos` — `GET /search/repositories?q=` → repos with owner, description, stars, last push. Typical: `pennylane api in:name,description`.
- `stargazers` — `GET /repos/{repo}/stargazers` (star+json accept) → `users[{login, type, starred_at}]`.
- `issues` — `GET /repos/{repo}/issues?state=open` (pull requests dropped) → title, author, reactions, labels.
- `owner` — `GET /orgs/{login}` or `/users/{login}` → `blog`, `company`, `email`, `location`: the bridge from a login to a company domain.

**Pricing basis:** free on every tool. Rate limits: 5,000 requests/hour with a token, code search 10 requests/minute.

**Pitfalls:**
- Code search needs a token and only indexes default branches; forks are dropped by the play.
- Personal accounts rarely carry a company domain: `owner.blog` pointing at gmail, github.io or a personal site is not a company. The play keeps only owners that resolve to an apex domain outside a free-host list.
- Bots (`type: Bot`, logins ending in `[bot]`) are filtered.
