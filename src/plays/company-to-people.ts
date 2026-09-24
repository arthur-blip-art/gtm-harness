import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { apexDomain, normalizeLinkedin } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';

export const NAME = 'company-to-people';
export const DESCRIPTION = 'People at a known domain matching titles/seniorities: apollo search, prospeo fallback. Returns rows ready for the email play.';

export const Input = z.object({
  domain: z.string().min(1),
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
    const sources: Array<[string, string, string, Record<string, unknown>]> = [
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
      for (const p of (o?.people ?? o?.results ?? []) as Record<string, unknown>[]) {
        const li = normalizeLinkedin(p.linkedin_url);
        const key = li ?? `${String(p.first_name).toLowerCase()}|${String(p.last_name).toLowerCase()}`;
        if (seen.has(key) || !p.first_name || !p.last_name) continue;
        seen.add(key);
        people.push({ first_name: String(p.first_name), last_name: String(p.last_name), title: p.title ? String(p.title ?? p.job_title) : undefined, linkedin_url: li ?? undefined, domain, source: id });
        meta.accepted++;
        if (people.length >= input.limit) break;
      }
    }
    return { domain, total, people };
  },
});
