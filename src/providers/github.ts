import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { norm } from '../core/normalize.ts';

/**
 * GitHub REST API. Free (5,000 req/h with a token, 10 code searches/min). Used for developer-side buying
 * signals: who stars or imports a competitor SDK, who opens "missing integration" issues.
 * GITHUB_TOKEN: a fine-grained token with public read access is enough.
 */
const BASE = 'https://api.github.com';
const PRICE = {
  search_code: { basis: 'free', credits: 0, note: 'free; 10 req/min, auth required' },
  search_repos: { basis: 'free', credits: 0, note: 'free; 30 req/min' },
  stargazers: { basis: 'free', credits: 0, note: 'free; 100 per page' },
  issues: { basis: 'free', credits: 0, note: 'free; 100 per page' },
  owner: { basis: 'free', credits: 0, note: 'free; org or user profile' },
} as const;

const headers = (accept = 'application/vnd.github+json') => ({
  accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'gtm-harness',
  ...(env('GITHUB_TOKEN') ? { authorization: `Bearer ${env('GITHUB_TOKEN')}` } : {}),
});
const repoOf = (v: unknown) => norm(v).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
const list = <T>(items: T[], key: string, miss: string, extra: Record<string, unknown> = {}) =>
  items.length ? { status: 'hit' as const, output: { [key]: items, count: items.length, ...extra } } : { status: 'miss' as const, missReason: miss, output: { [key]: [], count: 0, ...extra } };

export const github = defineAdapter({
  name: 'github',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-13 (free API, rate limits only)', table: PRICE },
  requiredEnv: ['GITHUB_TOKEN'],
  tools: {
    search_code: {
      description: 'Code search, e.g. `"@codat/accounting" filename:package.json` → repos that import a competitor SDK.',
      normalize: (i) => ({ q: String(i.q ?? '').trim(), per_page: Math.min(Number(i.per_page ?? 50), 100), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const qs = new URLSearchParams({ q: String(i.q), per_page: String(i.per_page), page: String(i.page) });
        const { status, body } = await httpJson(ctx, `${BASE}/search/code?${qs}`, { headers: headers() });
        if (status !== 200) return errorResult(status, body, body?.message);
        const items = ((body?.items ?? []) as any[]).map((x) => ({ repo: x.repository?.full_name, owner: x.repository?.owner?.login, owner_type: x.repository?.owner?.type, path: x.path, url: x.html_url, fork: x.repository?.fork ?? false }));
        return list(items, 'items', 'no_results', { total: body?.total_count ?? items.length });
      },
      cost: costFromTable(PRICE.search_code),
    },
    search_repos: {
      description: 'Repository search, e.g. `pennylane api in:name,description`.',
      normalize: (i) => ({ q: String(i.q ?? '').trim(), per_page: Math.min(Number(i.per_page ?? 30), 100), sort: String(i.sort ?? 'updated') }),
      async execute(i, ctx) {
        const qs = new URLSearchParams({ q: String(i.q), per_page: String(i.per_page), sort: String(i.sort) });
        const { status, body } = await httpJson(ctx, `${BASE}/search/repositories?${qs}`, { headers: headers() });
        if (status !== 200) return errorResult(status, body, body?.message);
        const items = ((body?.items ?? []) as any[]).map((x) => ({ repo: x.full_name, owner: x.owner?.login, owner_type: x.owner?.type, description: x.description, stars: x.stargazers_count, pushed_at: x.pushed_at, url: x.html_url, fork: x.fork }));
        return list(items, 'items', 'no_results', { total: body?.total_count ?? items.length });
      },
      cost: costFromTable(PRICE.search_repos),
    },
    stargazers: {
      description: 'People who starred a repo, oldest first. page: "last" reads the newest 100 (via the Link header), newest first.',
      normalize: (i) => ({ repo: repoOf(i.repo), page: i.page === 'last' ? 'last' : Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const get = (page: unknown) => httpJson(ctx, `${BASE}/repos/${i.repo}/stargazers?per_page=100&page=${page}`, { headers: headers('application/vnd.github.star+json') });
        let { status, body, headers: h } = await get(i.page === 'last' ? 1 : i.page);
        const last = i.page === 'last' ? Number(/[?&]page=(\d+)>; rel="last"/.exec(h.get('link') ?? '')?.[1] ?? 1) : 1;
        if (status === 200 && last > 1) ({ status, body } = await get(last));
        if (status !== 200) return errorResult(status, body, body?.message);
        const items = ((body ?? []) as any[]).map((x) => ({ login: x.user?.login ?? x.login, type: x.user?.type ?? x.type, starred_at: x.starred_at ?? null }));
        if (i.page === 'last') items.reverse();
        return list(items, 'users', 'no_stargazers');
      },
      cost: costFromTable(PRICE.stargazers),
    },
    issues: {
      description: 'Open issues of a repo (pull requests excluded), with reactions count.',
      normalize: (i) => ({ repo: repoOf(i.repo), state: String(i.state ?? 'open'), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/repos/${i.repo}/issues?state=${i.state}&per_page=100&page=${i.page}&sort=created&direction=desc`, { headers: headers() });
        if (status !== 200) return errorResult(status, body, body?.message);
        const items = ((body ?? []) as any[]).filter((x) => !x.pull_request).map((x) => ({ number: x.number, title: x.title, url: x.html_url, author: x.user?.login, created_at: x.created_at, reactions: x.reactions?.total_count ?? 0, comments: x.comments ?? 0, labels: (x.labels ?? []).map((l: any) => l.name) }));
        return list(items, 'issues', 'no_issues');
      },
      cost: costFromTable(PRICE.issues),
    },
    owner: {
      description: 'Org or user profile: company, blog (website), email, location. The bridge from a login to a domain.',
      normalize: (i) => ({ login: norm(i.login), type: String(i.type ?? 'User') === 'Organization' ? 'orgs' : 'users' }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/${i.type}/${encodeURIComponent(String(i.login))}`, { headers: headers() });
        if (status === 404) return { status: 'miss', missReason: 'not_found', output: {} };
        if (status !== 200) return errorResult(status, body, body?.message);
        return { status: 'hit', output: { ...pick(body ?? {}, ['login', 'name', 'company', 'blog', 'email', 'location', 'bio', 'type']) } };
      },
      cost: costFromTable(PRICE.owner),
    },
  },
});
