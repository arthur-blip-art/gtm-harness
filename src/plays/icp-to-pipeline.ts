import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { Input as IcpInput, play as icpToCompanies, type Output as IcpOutput } from './icp-to-companies.ts';
import { play as companyToPeople, type Output as PeopleOutput } from './company-to-people.ts';
import { batch as emailBatch } from './name-domain-to-email.ts';
import { play as syncHubspot, type Output as SyncOutput } from './sync-hubspot.ts';
import type { BatchOutput } from '../core/row-play.ts';
import type { EmailCell } from '../core/types.ts';

export const NAME = 'icp-to-pipeline';
export const DESCRIPTION = 'Composition proof: icp-to-companies → company-to-people (per company) → name-domain-to-email:batch → optional sync-hubspot. One run, one receipt.';

export const Input = IcpInput.extend({
  titles: z.array(z.string()).min(1),
  people_per_company: z.number().int().min(1).max(20).default(3),
  sync: z.boolean().default(false),
});
export type Input = z.infer<typeof Input>;
export interface Output {
  companies: number; people: number; emails: { high: number; medium: number; hold: number; none: number }; sync?: SyncOutput; counts: IcpOutput['counts'];
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'pipeline', input: Input,
  async run(input, ctx) {
    const { titles, people_per_company, sync, ...icp } = input;
    const found = await ctx.runPlay<z.infer<typeof IcpInput>, IcpOutput>(icpToCompanies, { ...icp, limit: icp.limit ?? 50, size_only: false });
    ctx.log(`${found.companies.length} companies`);
    const rows: Record<string, string>[] = [];
    for (const c of found.companies) {
      const people = await ctx.runPlay<unknown, PeopleOutput>(companyToPeople, { domain: c.domain, titles, limit: people_per_company });
      for (const p of people.people) rows.push({ first_name: p.first_name, last_name: p.last_name, domain: p.domain, company: c.name ?? '', title: p.title ?? '', linkedin_url: p.linkedin_url ?? '' });
    }
    ctx.log(`${rows.length} people → email waterfall`);
    const emails = rows.length ? await ctx.runPlay<unknown, BatchOutput>(emailBatch, { rows, slug: `${NAME}:${ctx.runId.slice(0, 8)}` }) : { rows: [] };
    const conf = (k: string) => emails.rows.filter((r) => (r.cells.email as EmailCell | undefined)?.confidence === k).length;
    const out: Output = { companies: found.companies.length, people: rows.length, emails: { high: conf('HIGH'), medium: conf('MEDIUM'), hold: conf('HOLD'), none: emails.rows.filter((r) => !(r.cells.email as EmailCell | undefined)?.value).length }, counts: found.counts };
    if (sync) out.sync = await ctx.runPlay<unknown, SyncOutput>(syncHubspot, { domains: found.companies.map((c) => c.domain) });
    return out;
  },
});
