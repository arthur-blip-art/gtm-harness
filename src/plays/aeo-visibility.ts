import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { callTool, wordRe } from './market-watch.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'aeo-visibility';
export const DESCRIPTION = 'Share of voice in AI answers: asks buyer questions to an answer engine (Exa), counts brand vs competitor mentions, first-mention rank and cited domains, lists the questions where competitors appear and the brand does not (content to write), compares with last month.';

export const DEFAULT_QUESTIONS = [
  'Quelle est la meilleure API pour connecter son logiciel à Pennylane ?',
  'Best unified accounting API in Europe',
  'Codat alternatives for European accounting software',
  'Connecteur Sage et Cegid pour un éditeur SaaS',
  'How to integrate a SaaS with Exact Online, Odoo and Xero through one API',
  'API unifiée comptabilité France',
  'Merge vs Codat vs Apideck for accounting integrations',
  'Comment synchroniser les factures de mon SaaS avec les logiciels comptables des clients ?',
];

export const Input = z.object({
  questions: z.array(z.string().min(3)).min(1).default(DEFAULT_QUESTIONS).describe('buyer questions, FR and EN'),
  brand: z.string().default('Chift'),
  competitors: z.array(z.string()).default(['Codat', 'Merge', 'Apideck', 'Rutter', 'Kombo']),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
export interface Answer { question: string; mentions: Record<string, number | null>; brand_mentioned: boolean; competitors_mentioned: string[]; cited_domains: string[]; excerpt: string }
export interface Output {
  month: string; answered: number;
  mention_rate: Record<string, number>; previous_rate: Record<string, number> | null; delta: Record<string, number> | null;
  gaps: Array<{ question: string; competitors: string[] }>;
  answers: Answer[]; notified: 'sent' | 'skipped' | 'failed' | 'none';
}

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const prevMonth = (m: string) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

/** Rank of first mention per name (1 = cited first), null when absent. */
export function mentionRanks(text: string, names: string[]): Record<string, number | null> {
  const pos = names.map((n) => [n, wordRe(n).exec(text)?.index ?? -1] as const);
  const order = pos.filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n);
  return Object.fromEntries(names.map((n) => [n, order.includes(n) ? order.indexOf(n) + 1 : null]));
}

const rates = (answers: Array<Pick<Answer, 'mentions'>>, names: string[]) => Object.fromEntries(names.map((n) => [n, pct(answers.filter((a) => a.mentions[n] != null).length, answers.length)]));

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const month = new Date().toISOString().slice(0, 7);
    const names = [input.brand, ...input.competitors.filter((c) => c.toLowerCase() !== input.brand.toLowerCase())];
    const domain = `aeo:${input.brand.toLowerCase()}`;
    const answers: Answer[] = [];
    const signals: Signal[] = [];
    if (legEnabled(ctx, 'exa', 'exa_answer')) {
      for (const question of input.questions) {
        const r = await callTool(ctx, `answer:${question.slice(0, 40)}`, 'exa', 'answer', { query: question }, 7 * 86400000);
        if (!r) continue;
        const text = String(r.out.answer ?? '');
        const mentions = mentionRanks(text, names);
        const cited_domains = [...new Set(((r.out.citations ?? []) as any[]).map((c) => apexDomain(c.url)).filter((d): d is string => !!d))];
        const a: Answer = { question, mentions, brand_mentioned: mentions[input.brand] != null, competitors_mentioned: names.slice(1).filter((n) => mentions[n] != null), cited_domains, excerpt: text.replace(/\s+/g, ' ').slice(0, 1000) };
        answers.push(a);
        signals.push({ dedupeKey: key('aeo_answer', question, month), domain, type: 'aeo_answer', source: 'exa', observedAt: new Date().toISOString(), receiptId: r.receipt.id, value: { ...a, month, brand: input.brand } });
      }
    }

    const previous = (await ctx.store.listSignals([domain])).filter((s) => s.type === 'aeo_answer' && s.value.month === prevMonth(month)).map((s) => s.value as unknown as Answer);
    await ctx.store.upsertSignals(signals);
    const mention_rate = rates(answers, names);
    const previous_rate = previous.length ? rates(previous, names) : null;
    const delta = previous_rate ? Object.fromEntries(names.map((n) => [n, mention_rate[n] - previous_rate[n]])) : null;
    const gaps = answers.filter((a) => !a.brand_mentioned && a.competitors_mentioned.length).map((a) => ({ question: a.question, competitors: a.competitors_mentioned }));

    let notified: Output['notified'] = 'none';
    if (input.notify && answers.length) {
      const fmt = (n: string) => `${n} ${mention_rate[n]}%${delta ? ` (${delta[n] >= 0 ? '+' : ''}${delta[n]})` : ''}`;
      const lines = [`Mention rate: ${names.map(fmt).join(' · ')}`, ...gaps.slice(0, 8).map((g) => `• gap: "${g.question}" → ${g.competitors.join(', ')}`)];
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`AEO visibility ${month}: ${input.brand} cited in ${mention_rate[input.brand]}% of ${answers.length} answers, ${gaps.length} gap(s)\n${lines.slice(0, 9).join('\n')}`);
    }
    ctx.log(`${answers.length} answers, ${input.brand} ${mention_rate[input.brand] ?? 0}%, ${gaps.length} gaps, slack=${notified}`);
    return { month, answered: answers.length, mention_rate, previous_rate, delta, gaps, answers, notified };
  },
});
