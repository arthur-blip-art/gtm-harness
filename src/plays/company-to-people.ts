import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { apexDomain, normalizeLinkedin } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { callLeg, canRun } from '../core/leg.ts';
import type { LegMeta } from '../core/types.ts';

export const NAME = 'company-to-people';
export const DESCRIPTION = 'People at a known domain matching titles, cheapest first: legal officers from the public registry (free, FR), Google dorks on LinkedIn profiles via Serper (~$0.001 a title), then FullEnrich search, Apollo and Prospeo for what is still missing. Returns rows ready for the email play.';

const EXEC = /\b(ceo|founder|co-?founder|fondateur|pr[ée]sident|president|dg|directeur g[ée]n[ée]ral|managing director|g[ée]rant|owner|chief executive)\b/i;
const ROLE_FR: Array<[RegExp, string]> = [[/pr[ée]sident/i, 'CEO (Président)'], [/directeur g[ée]n[ée]ral/i, 'Managing Director (DG)'], [/g[ée]rant/i, 'Managing Director (Gérant)']];

/** "Jane Doe - Head of Sales - Acme | LinkedIn" → {first, last, title} when the company matches. */
export function parseLinkedinResult(title: string, snippet: string, company: string): { first_name: string; last_name: string; title?: string } | null {
  const clean = title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const parts = clean.split(/\s+[-–—]\s+/);
  const name = parts[0]?.trim() ?? '';
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4 || /\d/.test(name)) return null;
  const tok = company.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0];
  if (!tok || !`${clean} ${snippet}`.toLowerCase().includes(tok)) return null;
  const role = parts.slice(1).find((p) => !p.toLowerCase().includes(tok)) ?? parts[1];
  return { first_name: words[0], last_name: words.slice(1).join(' '), title: role?.replace(/\s+(chez|at|@)\s+.*$/i, '').trim() || undefined };
}

export const Input = z.object({
  domain: z.string().min(1),
  company: z.string().optional().describe('company name for the free legs; read from the store when absent'),
  titles: z.array(z.string()).min(1),
  seniorities: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});
export type Input = z.infer<typeof Input>;
export interface PersonHit { first_name: string; last_name: string; title?: string; linkedin_url?: string; domain: string; source: string }
export interface Output { domain: string; total: number | null; people: PersonHit[] }

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const domain = apexDomain(input.domain) ?? input.domain;
    const people: PersonHit[] = [];
    let total: number | null = null;
    const seen = new Set<string>();
    const add = (p: Record<string, unknown>, id: string, meta?: LegMeta) => {
      const li = normalizeLinkedin(p.linkedin_url);
      const key = li ?? `${String(p.first_name).toLowerCase()}|${String(p.last_name).toLowerCase()}`;
      if (seen.has(key) || !p.first_name || !p.last_name || people.length >= input.limit) return;
      seen.add(key);
      people.push({ first_name: String(p.first_name), last_name: String(p.last_name), title: p.title ? String(p.title ?? p.job_title) : undefined, linkedin_url: li ?? undefined, domain, source: id });
      if (meta) meta.accepted++;
    };
    const company = (await ctx.store.listCompanies([domain]))[0];
    const name = input.company ?? company?.name ?? domain.split('.')[0];

    // Free: legal officers, when the ask is for the top of the company
    const officers = ((company?.raw as any)?.registry_fr?.officers ?? null) as Array<{ first_name: string | null; last_name: string; role: string | null }> | null;
    if (input.titles.some((t) => EXEC.test(t))) {
      let list = officers;
      if (!list && /^(fr|france)$/i.test(company?.country ?? '') && canRun(ctx, 'registry_fr')) {
        const rc = await callLeg(ctx, 'registry_officers', 'registry_fr', 'search_companies', { q: name, per_page: 1 });
        list = ((rc?.output as any)?.companies?.[0]?.officers ?? null);
      }
      const meta: LegMeta = { leg: 'registry_officers', provider: 'registry_fr', tool: 'officers', rowsReached: list ? 1 : 0, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      for (const o of list ?? []) if (o.first_name) add({ first_name: o.first_name.replace(/^\w/, (c) => c.toUpperCase()).replace(/\B\w+/, (w) => w.toLowerCase()), last_name: o.last_name.replace(/\B\w+/g, (w) => w.toLowerCase()), title: ROLE_FR.find(([re]) => re.test(o.role ?? ''))?.[1] ?? o.role ?? undefined }, 'registry_officers', meta);
    }

    // ~$0.001 a title: Google knows the public LinkedIn profiles
    if (people.length < input.limit && canRun(ctx, 'serper', 'serper_linkedin')) {
      for (const title of input.titles.slice(0, 4)) {
        if (people.length >= input.limit) break;
        const rc = await callLeg(ctx, 'serper_linkedin', 'serper', 'google_search', { q: `site:linkedin.com/in "${title}" "${name}"`, num: 10 });
        for (const r of ((rc?.output as any)?.results ?? []) as Array<{ title: string; link: string; snippet: string }>) {
          if (!/linkedin\.com\/in\//.test(r.link ?? '')) continue;
          const p = parseLinkedinResult(r.title ?? '', r.snippet ?? '', name);
          if (p) add({ ...p, linkedin_url: r.link }, 'serper_linkedin', rc?.meta);
        }
        if (rc?.meta) rc.meta.accepted = people.filter((p) => p.source === 'serper_linkedin').length;
      }
    }

    const sources: Array<[string, string, string, Record<string, unknown>]> = [
      ['fullenrich', 'fullenrich', 'search_people', { domains: [domain], titles: input.titles, seniorities: input.seniorities, limit: input.limit }],
      ['apollo', 'apollo', 'mixed_people_search', { domains: [domain], titles: input.titles, seniorities: input.seniorities, per_page: input.limit, page: 1 }],
      ['prospeo', 'prospeo', 'search_person', { filters: { company_website_or: [domain], job_title_or: input.titles, seniority_or: input.seniorities }, page: 1, limit: Math.min(input.limit, 25) }],
    ];
    for (const [id, provider, tool, query] of sources) {
      const meta: LegMeta = { leg: id, provider, tool, rowsReached: 0, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      if (people.length >= input.limit || !legEnabled(ctx, provider, id)) continue;
      meta.rowsReached = 1;
      const rc = await ctx.runner.execute({ provider, tool, input: query, runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      const o = rc.output as any;
      total ??= o?.total ?? o?.pagination?.total_entries ?? null;
      for (const p of (o?.people ?? o?.results ?? []) as Record<string, unknown>[]) add(p, id, meta);
    }
    return { domain, total, people };
  },
});
