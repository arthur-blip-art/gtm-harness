import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain, norm } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'github-signals';
export const DESCRIPTION = 'Developer-side buying signals from GitHub: repos importing a competitor SDK (Codat, Merge, Apideck, Rutter), stargazers and "missing integration" issue authors on competitor repos. Login → website → apex domain; personal hosts dropped. Diffs against the signals table, Slack digest. Free.';

export const Input = z.object({
  sdk_queries: z.array(z.string()).default(['"@codat" filename:package.json', '"codat" filename:requirements.txt', '"merge-api" filename:package.json', '"@apideck" filename:package.json', '"rutter" filename:package.json'])
    .describe('GitHub code search queries; the competitor is read from the query'),
  repos: z.array(z.string()).default([]).describe('competitor repos (owner/name or URL) whose stargazers and issues we read'),
  issue_keywords: z.string().default('integration|connector|support for|missing|accounting|ledger|xero|quickbooks|sage|pennylane|exact|odoo|datev').describe('regex (word-bounded, case-insensitive) on issue titles'),
  enrich: z.boolean().default(false).describe('company-enrich + score-accounts on domains not yet in the store (paid legs)'),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
export interface Output { new_signals: number; by_type: Record<string, number>; domains: string[]; ignored_logins: string[]; enriched: number; notified: 'sent' | 'skipped' | 'failed' | 'none'; signals: Signal[] }

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const COMPETITORS = /codat|merge|apideck|rutter/i;
/** Hosts that say nothing about an employer: code hosting, blogs, link-in-bio, free mail. */
const PERSONAL_HOSTS = /(^|\.)(github\.io|github\.com|gitlab\.io|gitlab\.com|gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|yahoo\.[a-z.]+|proton\.me|protonmail\.com|icloud\.com|medium\.com|linkedin\.com|twitter\.com|x\.com|vercel\.app|netlify\.app|herokuapp\.com|wordpress\.com|blogspot\.com|substack\.com|dev\.to|hashnode\.dev|notion\.site|about\.me|linktr\.ee|carrd\.co|pages\.dev|wixsite\.com|youtube\.com|instagram\.com|facebook\.com|bsky\.app|mastodon\.social|keybase\.io|stackoverflow\.com|npmjs\.com)$/;
const isBot = (u: { login?: string; type?: string }) => u.type === 'Bot' || /\[bot\]$|^dependabot|^renovate|-bot$/i.test(u.login ?? '');
const competitorOf = (s: string) => (COMPETITORS.exec(s)?.[0] ?? norm(s).split('/')[0]).toLowerCase();
const repoName = (s: string) => norm(s).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');

interface Lead { type: 'github_sdk_user' | 'github_stargazer' | 'github_issue'; login: string; ownerType?: string; repo: string; evidence_url: string; competitor: string; observedAt?: string; title?: string }

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const empty: Output = { new_signals: 0, by_type: {}, domains: [], ignored_logins: [], enriched: 0, notified: 'none', signals: [] };
    if (!legEnabled(ctx, 'github')) { ctx.log('GITHUB_TOKEN missing: nothing to pull (use --dry-run to exercise the flow)'); return empty; }
    const issueRe = new RegExp(`\\b(${input.issue_keywords})\\b`, 'i');
    const call = async (leg: string, tool: string, inp: Record<string, unknown>) => {
      const meta: LegMeta = { leg, provider: 'github', tool, rowsReached: 1, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      const rc = await ctx.runner.execute({ provider: 'github', tool, input: inp, runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      const out = (rc.output as any) ?? {};
      meta.accepted = Number(out.count ?? (rc.status === 'hit' ? 1 : 0));
      return rc.status === 'hit' ? { out, receiptId: rc.id } : null;
    };

    const leads: Lead[] = [];
    for (const q of input.sdk_queries) {
      const r = await call(`sdk:${competitorOf(q)}`, 'search_code', { q });
      for (const it of (r?.out.items ?? []) as any[]) if (!it.fork && it.owner) leads.push({ type: 'github_sdk_user', login: it.owner, ownerType: it.owner_type, repo: it.repo, evidence_url: it.url, competitor: competitorOf(q) });
    }
    for (const raw of input.repos) {
      const repo = repoName(raw);
      const competitor = competitorOf(repo);
      const stars = await call(`stargazers:${repo}`, 'stargazers', { repo });
      for (const u of (stars?.out.users ?? []) as any[]) if (u.login && !isBot(u)) leads.push({ type: 'github_stargazer', login: u.login, ownerType: u.type, repo, evidence_url: `https://github.com/${repo}/stargazers`, competitor, observedAt: u.starred_at ?? undefined });
      const issues = await call(`issues:${repo}`, 'issues', { repo });
      for (const i of (issues?.out.issues ?? []) as any[]) if (i.author && !isBot({ login: i.author }) && issueRe.test(String(i.title ?? ''))) leads.push({ type: 'github_issue', login: i.author, repo, evidence_url: i.url, competitor, observedAt: i.created_at ?? undefined, title: i.title });
    }

    // login → website → apex domain, once per login
    const owners = new Map<string, { domain: string | null; name?: string; receiptId?: string }>();
    for (const l of leads) {
      if (owners.has(l.login)) continue;
      const r = await call(`owner:${l.login}`, 'owner', { login: l.login, type: l.ownerType ?? 'User' });
      const o = r?.out ?? {};
      const domain = [o.blog, typeof o.email === 'string' ? o.email : null].map((x) => apexDomain(x)).find((d): d is string => !!d && !PERSONAL_HOSTS.test(d)) ?? null;
      owners.set(l.login, { domain, name: o.name ?? undefined, receiptId: r?.receiptId });
    }
    const ignored = [...owners].filter(([, o]) => !o.domain).map(([login]) => login);

    const now = new Date().toISOString();
    const signals: Signal[] = [];
    for (const l of leads) {
      const o = owners.get(l.login)!;
      if (!o.domain) continue;
      signals.push({
        dedupeKey: key(l.type, l.login, l.repo, l.type === 'github_issue' ? l.evidence_url : l.competitor), domain: o.domain, type: l.type, source: 'github', observedAt: l.observedAt ?? now, receiptId: o.receiptId,
        value: { login: l.login, owner_name: o.name, repo: l.repo, evidence_url: l.evidence_url, competitor: l.competitor, ...(l.title ? { issue_title: l.title } : {}) },
      });
    }
    const uniq = [...new Map(signals.map((s) => [s.dedupeKey, s])).values()];
    const domains = [...new Set(uniq.map((s) => s.domain))];
    const before = new Set((await ctx.store.listSignals(domains)).map((s) => s.dedupeKey));
    const fresh = uniq.filter((s) => !before.has(s.dedupeKey));
    await ctx.store.upsertSignals(uniq);
    const by_type: Record<string, number> = {};
    for (const s of fresh) by_type[s.type] = (by_type[s.type] ?? 0) + 1;

    const enriched = input.enrich ? await enrichNew([...new Set(fresh.map((s) => s.domain))], ctx) : 0;

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const verb: Record<string, string> = { github_sdk_user: 'imports', github_stargazer: 'starred', github_issue: 'asked on' };
      const lines = fresh.slice(0, 10).map((s) => { const v = s.value as any; return `• ${s.domain} (${v.login}) ${verb[s.type]} ${v.competitor}${v.issue_title ? `: "${v.issue_title}"` : ''} ${v.evidence_url}`; });
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`GitHub signals: ${fresh.length} new on ${new Set(fresh.map((s) => s.domain)).size} domains\n${lines.join('\n')}`);
    }
    ctx.log(`${leads.length} leads, ${owners.size} logins (${ignored.length} without a company domain), ${fresh.length} new signals, slack=${notified}`);
    return { new_signals: fresh.length, by_type, domains, ignored_logins: ignored, enriched, notified, signals: fresh };
  },
});

async function enrichNew(domains: string[], ctx: PlayCtx): Promise<number> {
  const known = new Set((await ctx.store.listCompanies(domains)).map((c) => c.domain));
  const todo = domains.filter((d) => !known.has(d));
  for (const domain of todo) await ctx.runPlay('company-enrich', { domain });
  if (todo.length) await ctx.runPlay('score-accounts', { domains: todo });
  return todo.length;
}
