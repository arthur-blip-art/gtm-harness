import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { ToolRunner } from '../core/tools.ts';
import { createNotifier } from '../core/notify.ts';
import { registry } from '../providers/index.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta, Receipt } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'market-watch';
export const DESCRIPTION = 'Sector watch: Google News and Hacker News on a keyword list over the last day or week, deduplicated by URL, classified by rules (regulation, competitor, funding, partnership, launch, builder pain). Diffs against the signals table, Slack digest by category.';

export const CATEGORIES = ['pain', 'regulation', 'competitor', 'funding', 'partnership', 'launch', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const Input = z.object({
  keywords: z.array(z.string().min(1)).min(1).describe('e.g. "facture électronique PDP", "e-invoicing", "Codat", "unified API accounting"'),
  sources: z.array(z.enum(['news', 'hackernews'])).default(['news', 'hackernews']),
  window: z.enum(['day', 'week']).default('week'),
  competitors: z.array(z.string()).default(['Codat', 'Merge.dev', 'Apideck', 'Rutter', 'Kombo']).describe('names that put an item in the competitor category'),
  gl: z.string().default('fr').describe('Google News country'),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
export interface Item { url: string; title: string; snippet: string; source: string; origin: 'news' | 'hackernews'; keyword: string; date?: string | null; category: Category }
export interface Output { seen: number; new_items: number; by_category: Partial<Record<Category, number>>; notified: 'sent' | 'skipped' | 'failed' | 'none'; items: Item[] }

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const WINDOW_MS = { day: 86400000, week: 7 * 86400000 } as const;

/**
 * One provider call as a leg: meta + receipt + spend. Receipts are cached with no TTL, so a recurring
 * watch passes `maxAgeMs`: a cached receipt older than that is fetched again (refresh runner).
 */
export async function callTool(ctx: PlayCtx, leg: string, provider: string, tool: string, input: Record<string, unknown>, maxAgeMs?: number): Promise<{ out: any; receipt: Receipt } | null> {
  const meta: LegMeta = { leg, provider, tool, rowsReached: 1, accepted: 0, receiptIds: [] };
  ctx.metas.push(meta);
  const rc = await executeFresh(ctx, provider, tool, input, maxAgeMs);
  meta.receiptIds!.push(rc.id);
  if (!rc.cached) ctx.spent.credits += rc.costCredits;
  if (rc.status !== 'hit') return null;
  meta.accepted = 1;
  return { out: (rc.output as any) ?? {}, receipt: rc };
}

/** runner.execute, but a cached receipt older than `maxAgeMs` is fetched again. */
export async function executeFresh(ctx: PlayCtx, provider: string, tool: string, input: Record<string, unknown>, maxAgeMs?: number): Promise<Receipt> {
  const rc = await ctx.runner.execute({ provider, tool, input, runId: ctx.runId });
  if (!rc.cached || maxAgeMs === undefined || Date.now() - Date.parse(rc.createdAt) <= maxAgeMs) return rc;
  return new ToolRunner(ctx.store, registry, { dryRun: ctx.dryRun, refresh: true, log: ctx.log }).execute({ provider, tool, input, runId: ctx.runId });
}

/** Canonical URL for dedupe: no fragment, no tracking params, no trailing slash, lowercase host. */
export function canonicalUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? ''));
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|mc_)/.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, '');
  } catch { return null; }
}

export const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
const RULES: Array<[Exclude<Category, 'competitor' | 'other'>, RegExp]> = [
  ['pain', /built (it|them|this|connectors?|integrations?) (ourselves|in-house)|building (connectors|integrations) ourselves|ended up building|nightmare|painful|pain in the|maintenance burden|galère|cauchemar|on a tout (refait|développé) en interne|enfer|so many (connectors|integrations)/i],
  ['regulation', /facture? (électronique|electronique)|facturation électronique|e-?invoic|\bpdp\b|\bppf\b|plateforme de dématérialisation|réforme|regulat|r[ée]glementation|directive|\bvida\b|peppol|d[ée]cret|\bloi\b|dgfip|compliance|conformit[ée]/i],
  ['funding', /(^|\s)l[èe]ve\b|lev[ée]e de fonds|raises?d?\b|series [a-e]\b|s[ée]rie [a-e]\b|seed|funding|financement|tour de table|valuation|valoris|acqui(ert|res?|red|sition)|rach[eè]te|rachat/i],
  ['partnership', /partenariat|partnership|partners? with|s'associe|teams up|alliance|int[ée]gr(e|ation) avec/i],
  ['launch', /\blance\b|\blancement\b|launch|unveil|d[ée]voile|introduc|nouveau (module|produit|connecteur)|new (feature|product|connector|api)|now available|disponible|release[ds]?\b|general availability|\bga\b/i],
];

export function classify(text: string, competitors: string[]): Category {
  if (RULES[0][1].test(text)) return 'pain'; // a builder complaining is the most actionable, whatever else it mentions
  if (RULES[1][1].test(text)) return 'regulation';
  if (competitors.some((c) => wordRe(c).test(text))) return 'competitor'; // "Merge.dev", not "Merge": the verb is too common
  for (const [cat, re] of RULES.slice(2)) if (re.test(text)) return cat;
  return 'other';
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const items = new Map<string, Item>();
    const maxAge = Math.round(WINDOW_MS[input.window] / 7); // a weekly watch tolerates a 1-day-old cache, a daily one ~3h
    const add = (it: Omit<Item, 'category'>) => {
      const url = canonicalUrl(it.url);
      if (!url || items.has(url)) return;
      items.set(url, { ...it, url, category: classify(`${it.title} ${it.snippet}`, input.competitors) });
    };

    for (const kw of input.keywords) {
      if (input.sources.includes('news') && legEnabled(ctx, 'serper', 'serper_news')) {
        const r = await callTool(ctx, `news:${kw}`, 'serper', 'news_search', { q: kw, gl: input.gl, tbs: input.window === 'day' ? 'qdr:d' : 'qdr:w' }, maxAge);
        for (const n of r?.out.results ?? []) if (n.link) add({ url: n.link, title: String(n.title ?? ''), snippet: String(n.snippet ?? ''), source: String(n.source ?? 'news'), origin: 'news', keyword: kw, date: n.date ?? null });
      }
      if (input.sources.includes('hackernews') && legEnabled(ctx, 'hackernews')) {
        // floored to the hour so reruns within the hour share a receipt
        const since = Math.floor((now - WINDOW_MS[input.window]) / 3600000) * 3600;
        const r = await callTool(ctx, `hn:${kw}`, 'hackernews', 'search', { query: kw, since });
        for (const h of r?.out.hits ?? []) if (h.url) add({ url: h.url, title: String(h.title ?? ''), snippet: String(h.text ?? '').replace(/\s+/g, ' ').slice(0, 400), source: 'hackernews', origin: 'hackernews', keyword: kw, date: h.created_at ?? null });
      }
    }

    const all = [...items.values()];
    const signals: Signal[] = all.map((it) => {
      const type = it.origin === 'news' ? 'market_news' : 'hn_mention';
      return { dedupeKey: key(type, it.url), domain: `market:${it.category}`, type, source: it.origin === 'news' ? 'serper' : 'hackernews', observedAt: nowIso, value: { ...it } };
    });
    const before = new Set((await ctx.store.listSignals(CATEGORIES.map((c) => `market:${c}`))).map((s) => s.dedupeKey));
    const freshKeys = new Set(signals.filter((s) => !before.has(s.dedupeKey)).map((s) => s.dedupeKey));
    const fresh = all.filter((_, i) => freshKeys.has(signals[i].dedupeKey));
    await ctx.store.upsertSignals(signals);
    const by_category: Output['by_category'] = {};
    for (const it of fresh) by_category[it.category] = (by_category[it.category] ?? 0) + 1;

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const lines: string[] = [];
      for (const cat of CATEGORIES) {
        const group = fresh.filter((it) => it.category === cat);
        if (!group.length || lines.length >= 9) continue;
        lines.push(`*${cat}* (${group.length})`);
        for (const it of group.slice(0, 2)) if (lines.length < 10) lines.push(`• ${it.title.slice(0, 110)} — ${it.url}`);
      }
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Market watch (${input.window}): ${fresh.length} new\n${lines.slice(0, 10).join('\n')}`);
    }
    ctx.log(`${all.length} items, ${fresh.length} new (${Object.entries(by_category).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}), slack=${notified}`);
    return { seen: all.length, new_items: fresh.length, by_category, notified, items: fresh };
  },
});
