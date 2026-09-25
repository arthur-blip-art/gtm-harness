import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { normalizeLinkedin, norm } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'linkedin-signals';
export const DESCRIPTION = 'Three LinkedIn signal agents via HarvestAPI: keyword posts, engagement on competitor posts, posts of tracked people. Diffs against the signals table, alerts Slack with what is new. Pull-based: run it on a schedule.';

export const Input = z.object({
  keywords: z.array(z.string()).default([]).describe('phrases to search in posts, e.g. "intégration comptable"'),
  competitors: z.array(z.string()).default([]).describe('LinkedIn company URLs or slugs, e.g. https://www.linkedin.com/company/codat'),
  profiles: z.array(z.string()).default([]).describe('LinkedIn profile URLs of tracked people (CTOs, champions)'),
  posted_limit: z.enum(['24h', 'week', 'month']).default('week'),
  max_posts_per_source: z.number().int().min(1).max(50).default(20),
  icp_title_pattern: z.string().default('cto|chief technology|vp eng|head of eng|head of product|cpo|partnership|integration|platform|founder').describe('regex on the engager title to flag ICP matches'),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
export interface Output { new_signals: number; by_type: Record<string, number>; icp_matches: number; notified: 'sent' | 'skipped' | 'failed' | 'none'; signals: Signal[] }

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const companyDomainKey = (companyOrSlug: unknown) => {
  const s = norm(companyOrSlug);
  const m = /linkedin\.com\/company\/([^/?#]+)/.exec(s);
  return `linkedin:${m ? m[1] : s.replace(/[^a-z0-9-]+/g, '-') || 'unknown'}`;
};
const excerpt = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const icp = new RegExp(input.icp_title_pattern, 'i');
    const signals: Signal[] = [];
    const now = new Date().toISOString();
    if (!legEnabled(ctx, 'harvestapi')) {
      ctx.log('HARVESTAPI_API_KEY missing: nothing to pull (use --dry-run to exercise the flow)');
      return { new_signals: 0, by_type: {}, icp_matches: 0, notified: 'none', signals: [] };
    }
    const call = async (leg: string, tool: string, inp: Record<string, unknown>) => {
      const meta: LegMeta = { leg, provider: 'harvestapi', tool, rowsReached: 1, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      const rc = await ctx.runner.execute({ provider: 'harvestapi', tool, input: inp, runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      const out = (rc.output as any) ?? {};
      meta.accepted = Number(out.count ?? 0);
      return rc.status === 'hit' ? out : null;
    };

    // Agent 1 — keyword posts: who is talking about the problem right now
    for (const kw of input.keywords) {
      const out = await call(`keyword:${kw}`, 'search_posts', { search: kw, postedLimit: input.posted_limit });
      for (const p of (out?.posts ?? []).slice(0, input.max_posts_per_source)) {
        if (!p.post_url) continue;
        signals.push({
          dedupeKey: key('keyword_post', p.post_url), domain: companyDomainKey(p.author_company), type: 'linkedin_keyword_post', source: 'harvestapi', observedAt: p.posted_at ?? now,
          value: { keyword: kw, post_url: p.post_url, author: p.author_name, author_title: p.author_title, author_linkedin: normalizeLinkedin(p.author_linkedin), author_company: p.author_company, excerpt: excerpt(p.text), icp_match: icp.test(String(p.author_title ?? '')) },
        });
      }
    }

    // Agent 2 — competitor engagement: who likes or comments what Codat / Merge / Apideck publish
    for (const comp of input.competitors) {
      const posts = await call(`competitor_posts:${comp}`, 'company_posts', { company: comp, postedLimit: input.posted_limit });
      for (const p of (posts?.posts ?? []).slice(0, input.max_posts_per_source)) {
        if (!p.post_url) continue;
        for (const [tool, kind] of [['post_reactions', 'reaction'], ['post_comments', 'comment']] as const) {
          const out = await call(`competitor_${kind}s:${comp}`, tool, { post: p.post_url });
          for (const person of out?.people ?? []) {
            if (!person.linkedin_url) continue;
            signals.push({
              dedupeKey: key('competitor_engagement', p.post_url, person.linkedin_url, kind), domain: companyDomainKey(comp), type: 'linkedin_competitor_engagement', source: 'harvestapi', observedAt: p.posted_at ?? now,
              value: { competitor: comp, post_url: p.post_url, post_excerpt: excerpt(p.text), engager: person.name, engager_title: person.title, engager_linkedin: person.linkedin_url, kind, comment: kind === 'comment' ? excerpt(person.text) : undefined, icp_match: icp.test(String(person.title ?? '')) },
            });
          }
        }
      }
    }

    // Agent 3 — tracked people: a new post from a CTO we follow is a reason to write this week
    for (const prof of input.profiles) {
      const url = normalizeLinkedin(prof);
      if (!url) continue;
      const out = await call(`tracked:${url.split('/in/')[1]}`, 'profile_posts', { profile: url, postedLimit: input.posted_limit });
      for (const p of (out?.posts ?? []).slice(0, input.max_posts_per_source)) {
        if (!p.post_url) continue;
        signals.push({
          dedupeKey: key('tracked_post', p.post_url), domain: companyDomainKey(p.author_company), type: 'linkedin_tracked_post', source: 'harvestapi', observedAt: p.posted_at ?? now,
          value: { profile: url, post_url: p.post_url, author: p.author_name, author_title: p.author_title, excerpt: excerpt(p.text), icp_match: true },
        });
      }
    }

    // Diff: only what the store has never seen counts as new
    const before = new Set((await ctx.store.listSignals([...new Set(signals.map((s) => s.domain))])).map((s) => s.dedupeKey));
    const fresh = signals.filter((s) => !before.has(s.dedupeKey));
    const inserted = await ctx.store.upsertSignals(signals);
    const by_type: Record<string, number> = {};
    for (const s of fresh) by_type[s.type] = (by_type[s.type] ?? 0) + 1;
    const icpMatches = fresh.filter((s) => (s.value as any).icp_match).length;

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const notifier = createNotifier({ dryRun: ctx.dryRun, log: ctx.log });
      const top = fresh.filter((s) => (s.value as any).icp_match).slice(0, 10);
      const lines = top.map((s) => {
        const v = s.value as any;
        if (s.type === 'linkedin_competitor_engagement') return `• ${v.engager} (${v.engager_title}) ${v.kind === 'comment' ? 'commented' : 'reacted'} on ${v.competitor}: ${v.post_url}`;
        return `• ${v.author} (${v.author_title}) — ${v.excerpt.slice(0, 120)}… ${v.post_url}`;
      });
      notified = await notifier.slack(`LinkedIn signals: ${fresh.length} new (${icpMatches} ICP matches)\n${lines.join('\n')}`);
    }
    ctx.log(`${signals.length} seen, ${fresh.length} new (${inserted} inserted), ${icpMatches} ICP matches, slack=${notified}`);
    return { new_signals: fresh.length, by_type, icp_matches: icpMatches, notified, signals: fresh };
  },
});
