import { z } from 'zod';
import type { LinkedinCell, Receipt, RowState } from '../core/types.ts';
import type { Leg, Extracted } from '../core/waterfall.ts';
import type { PlayCtx } from '../core/play.ts';
import { defineRowPlay } from '../core/row-play.ts';
import { linkedinPolicy, profileNameFromTitle } from '../core/linkedin-policy.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { apexDomain, norm } from '../core/normalize.ts';
import type { Store } from '../store/store.ts';

export const NAME = 'person-to-linkedin';
export const DESCRIPTION = 'LinkedIn profile URL from name + company (or domain), validated by the name gate.';
export const LEG_IDS = ['serper_company', 'serper_name', 'exa'];

export const Input = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  company: z.string().optional(),
  domain: z.string().optional(),
  title: z.string().optional(),
});
export type Input = z.infer<typeof Input>;

function companyToken(r: RowState): string {
  const c = r.input.company?.trim();
  if (c) return c;
  const apex = apexDomain(r.input.domain);
  return apex ? apex.split('.')[0] : '';
}

/** Each organic result is a candidate; the name gate decides, the company token sets HIGH vs MEDIUM. */
function extractResults(rc: Receipt, row: RowState): Extracted[] {
  const results: { title?: string; link?: string; url?: string; snippet?: string }[] = (rc.output as any)?.results ?? [];
  const token = norm(companyToken(row));
  return results
    .map((x) => ({ url: x.link ?? x.url ?? '', title: x.title ?? '', snippet: x.snippet ?? '' }))
    .filter((x) => /linkedin\.com\/in\//.test(x.url))
    .map((x) => ({ value: x.url, extra: { profileName: profileNameFromTitle(x.title), title: x.title, companyMatch: !!token && norm(`${x.title} ${x.snippet}`).includes(token) } }));
}

export function buildLegs(ctx: Pick<PlayCtx, 'dryRun' | 'legs'>): Leg[] {
  const leg = (id: string, provider: string, tool: string, buildInput: Leg['buildInput']): Leg => ({ id, provider, tool, enabled: legEnabled(ctx, provider, id), buildInput, extract: extractResults });
  const name = (r: RowState) => `"${r.input.first_name} ${r.input.last_name}"`;
  return [
    leg('serper_company', 'serper', 'google_search', (r) => { const c = companyToken(r); return c ? { q: `${name(r)} ${c} site:linkedin.com/in`, num: 5 } : null; }),
    leg('serper_name', 'serper', 'google_search', (r) => ({ q: `${name(r)} site:linkedin.com/in`, num: 5 })),
    leg('exa', 'exa', 'search', (r) => ({ query: `${r.input.first_name} ${r.input.last_name} ${companyToken(r)} linkedin profile`, numResults: 3 })),
  ];
}

export async function steps(rows: RowState[], ctx: PlayCtx) {
  await ctx.waterfall(rows, buildLegs(ctx), linkedinPolicy);
}

export async function writeGolden(rows: RowState[], store: Store) {
  for (const r of rows) {
    const cell = r.cells.linkedin_url as LinkedinCell | undefined;
    if (!cell?.value) continue;
    const domain = apexDomain(r.input.domain) ?? undefined;
    await store.upsertPerson({
      personKey: r.rowKey, firstName: r.input.first_name, lastName: r.input.last_name, domain, linkedinUrl: cell.value,
      linkedinSource: cell.source ?? undefined, linkedinConfidence: cell.confidence, email: null, emailStatus: null, emailSource: null, confidence: 'LOW',
      fieldSources: { linkedin_url: cell.source ?? 'unknown' }, raw: {},
    });
  }
}

export const { scalar, batch } = defineRowPlay<Input, LinkedinCell>({
  name: NAME, description: DESCRIPTION, input: Input, field: 'linkedin_url', legIds: LEG_IDS, steps, output: (r) => r.cells.linkedin_url as LinkedinCell, golden: writeGolden,
});
