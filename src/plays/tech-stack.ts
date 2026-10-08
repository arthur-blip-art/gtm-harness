import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { callLeg } from '../core/leg.ts';
import { atsJobs, readSite } from '../core/site.ts';
import { dmarcPolicy, fingerprint, type Tech } from '../core/tech-fingerprint.ts';
import { BatchInput, type BatchOutput } from '../core/row-play.ts';
import type { RowState } from '../core/types.ts';

export const NAME = 'tech-stack';
export const DESCRIPTION = 'Sales, marketing and product stack of a domain from free public evidence: DNS (MX, SPF, TXT verifications), website source (pixels, chat, analytics, ABM, billing) and its own job ads. Each tool comes with its evidence. Updates companies.tech.';

export const Input = z.object({ domain: z.string().min(1) });
export type Input = z.infer<typeof Input>;
export interface Output { domain: string; tech: Tech[]; by_category: Record<string, string[]>; email: { mx: string[]; dmarc: string | null }; jobs_read: number }

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const domain = apexDomain(input.domain) ?? input.domain;
    const site = await readSite(ctx, domain, ['careers', 'integrations', 'pricing'], 3);
    const dnsRc = await callLeg(ctx, 'dns', 'web', 'dns_records', { domain });
    const dns = dnsRc?.status === 'hit' ? (dnsRc.output as any) : null;
    const { jobs } = await atsJobs(ctx, site.ats);
    const tech = fingerprint({ dns, pages: [site.home, ...Object.values(site.pages)].filter(Boolean) as any, jobs });
    const by_category: Record<string, string[]> = {};
    for (const t of tech) (by_category[t.category] ??= []).push(t.name);
    if (tech.length) await ctx.store.upsertCompany({ domain, tech: tech.map((t) => t.name), fieldSources: { tech: 'fingerprint' }, raw: { tech_evidence: tech } });
    return { domain, tech, by_category, email: { mx: dns?.mx ?? [], dmarc: dmarcPolicy(dns?.dmarc) }, jobs_read: jobs.length };
  },
});

export const batch = definePlay<BatchInput, BatchOutput>({
  name: `${NAME}:batch`, description: `${DESCRIPTION} (batch over a domain column)`, kind: 'batch', input: BatchInput,
  async run(input, ctx) {
    const { datasetId, rows } = await ctx
      .dataset(input.rows, { slug: input.slug, rowKey: (r) => `co:${apexDomain(r.domain) ?? r.domain}` })
      .withColumn('tech', async (row: RowState) => (row.input.domain ? await play.run({ domain: row.input.domain }, ctx) : { status: 'skipped', missReason: 'missing_domain' }), { concurrency: 3 })
      .run();
    return { rows, field: 'tech', legIds: [], datasetId };
  },
});
