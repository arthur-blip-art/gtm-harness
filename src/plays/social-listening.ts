import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { callLeg, canRun } from '../core/leg.ts';
import { sha256 } from '../core/hash.ts';
import { createNotifier } from '../core/notify.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'social-listening';
export const DESCRIPTION = 'Who talks about a brand, a competitor or a problem, across the web, cheapest first: Hacker News and Google News (free), LinkedIn posts (HarvestAPI, ~$0.002 a post), Reddit and X (ScrapeCreators, ~$0.002 a call), web mentions (Exa, ~$0.005). Flags buying intent ("alternative to", "looking for", "on cherche"). New mentions → signals + optional Slack.';

export const Input = z.object({
  terms: z.array(z.string()).min(1).describe('brand names, competitor names, problem phrases ("accounting API", "alternative to Codat")'),
  x_handles: z.array(z.string()).default([]).describe('X accounts to read (competitors, our brand)'),
  days: z.number().int().min(1).max(365).default(14),
  sources: z.array(z.enum(['hn', 'news', 'linkedin', 'reddit', 'x', 'web'])).default(['hn', 'news', 'linkedin', 'reddit', 'x', 'web']),
  max_per_source: z.number().int().min(1).max(50).default(15),
  notify: z.boolean().default(false),
});
export type Input = z.infer<typeof Input>;
export interface Mention { source: string; term: string; title: string; url: string; date: string | null; author: string | null; intent: boolean }
export interface Output { mentions: Mention[]; new_mentions: number; intent: number; by_source: Record<string, number>; notified: 'sent' | 'skipped' | 'failed' | 'none' }

const INTENT = /\b(alternative to|alternatives? (à|a)|looking for|recommend(ations?)?|any(one)? (use|using|tried)|switch(ing)? from|replace|vs\.?|versus|on cherche|vous conseillez|quelqu.un (utilise|conna[iî]t)|remplacer|migrer de|retour d.exp[ée]rience)\b/i;
const key = (...p: unknown[]) => sha256(p.map(String).join('|')).slice(0, 32);

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const mentions: Mention[] = [];
    const push = (m: Omit<Mention, 'intent'>) => { if (m.url && m.title) mentions.push({ ...m, title: m.title.slice(0, 300), intent: INTENT.test(m.title) }); };
    const on = (s: Input['sources'][number]) => input.sources.includes(s);
    const cap = input.max_per_source;

    for (const term of input.terms) {
      if (on('hn')) {
        const rc = await callLeg(ctx, 'hn', 'publicweb', 'hn_search', { query: term, days: input.days });
        for (const h of (((rc?.output as any)?.hits ?? []) as any[]).slice(0, cap)) push({ source: 'hacker_news', term, title: h.title ?? h.text, url: h.hn_url, date: h.created_at, author: h.author });
      }
      if (on('news')) {
        const rc = await callLeg(ctx, 'news', 'publicweb', 'news_search', { q: `"${term}"`, days: input.days });
        for (const n of (((rc?.output as any)?.items ?? []) as any[]).slice(0, cap)) push({ source: 'news', term, title: n.title, url: n.link, date: n.published_at, author: n.source });
      }
      if (on('linkedin') && canRun(ctx, 'harvestapi', 'linkedin')) {
        const rc = await callLeg(ctx, 'linkedin', 'harvestapi', 'search_posts', { search: term, postedLimit: input.days <= 1 ? '24h' : input.days <= 7 ? 'week' : 'month' });
        for (const p of (((rc?.output as any)?.posts ?? []) as any[]).slice(0, cap)) push({ source: 'linkedin', term, title: `${p.author_name ?? ''} (${p.author_title ?? ''}): ${p.text ?? ''}`, url: p.post_url, date: p.posted_at, author: p.author_linkedin ?? p.author_name });
      }
      if (on('reddit') && canRun(ctx, 'scrapecreators', 'reddit')) {
        const rc = await callLeg(ctx, 'reddit', 'scrapecreators', 'reddit_search', { query: term, timeframe: input.days <= 7 ? 'week' : input.days <= 31 ? 'month' : 'year' });
        for (const p of (((rc?.output as any)?.posts ?? []) as any[]).slice(0, cap)) push({ source: 'reddit', term, title: `${p.title}${p.text ? `: ${p.text}` : ''}`, url: p.url, date: p.created_at, author: p.subreddit });
      }
      if (on('web') && canRun(ctx, 'exa', 'web')) {
        const rc = await callLeg(ctx, 'web', 'exa', 'search', { query: `${term} review OR opinion OR alternative`, numResults: Math.min(cap, 10) });
        for (const r of (((rc?.output as any)?.results ?? []) as any[]).slice(0, cap)) push({ source: 'web', term, title: r.title ?? r.url, url: r.url, date: null, author: null });
      }
    }
    if (on('x') && canRun(ctx, 'scrapecreators', 'x')) {
      for (const handle of input.x_handles) {
        const rc = await callLeg(ctx, 'x', 'scrapecreators', 'twitter_user_tweets', { handle });
        const since = Date.now() - input.days * 86400000;
        for (const t of (((rc?.output as any)?.tweets ?? []) as any[]).filter((t) => !t.created_at || Date.parse(t.created_at) >= since).slice(0, cap)) push({ source: 'x', term: `@${handle}`, title: t.text, url: t.url, date: t.created_at ? new Date(Date.parse(t.created_at)).toISOString() : null, author: handle });
      }
    }

    const now = new Date().toISOString();
    const signals: Signal[] = mentions.map((m) => ({ dedupeKey: key('mention', m.url), domain: `topic:${m.term.toLowerCase()}`, type: 'mention', source: m.source, observedAt: m.date ?? now, value: { ...m } }));
    const before = new Set((await ctx.store.listSignals([...new Set(signals.map((s) => s.domain))])).map((s) => s.dedupeKey));
    const fresh = signals.filter((s) => !before.has(s.dedupeKey));
    await ctx.store.upsertSignals(signals);
    const by_source: Record<string, number> = {};
    for (const m of mentions) by_source[m.source] = (by_source[m.source] ?? 0) + 1;
    const freshMentions = fresh.map((s) => s.value as unknown as Mention);
    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const top = [...freshMentions].sort((a, b) => Number(b.intent) - Number(a.intent)).slice(0, 10);
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Social listening: ${fresh.length} new mentions (${freshMentions.filter((m) => m.intent).length} with buying intent)\n${top.map((m) => `• [${m.source}] ${m.intent ? '🔥 ' : ''}${m.title.slice(0, 140)} ${m.url}`).join('\n')}`);
    }
    return { mentions, new_mentions: fresh.length, intent: freshMentions.filter((m) => m.intent).length, by_source, notified };
  },
});
