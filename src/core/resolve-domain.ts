import type { PlayCtx } from './play.ts';
import { callLeg, canRun } from './leg.ts';
import { apexDomain } from './normalize.ts';

/** Directories, registries, social and review sites: never a company's own domain. */
export const NOT_A_COMPANY = /(^|\.)(linkedin|facebook|twitter|x|instagram|youtube|wikipedia|crunchbase|pappers|societe|verif|infogreffe|annuaire-entreprises|data\.gouv|manageo|kompass|corporama|g2|capterra|getapp|trustpilot|glassdoor|indeed|welcometothejungle|medium|github|producthunt|bloomberg|reuters|techcrunch|lesechos|maddyness|zoominfo|apollo|rocketreach|dnb|owler|craft|tracxn|dealroom|pitchbook|cbinsights|google|apple|microsoft|amazon)\.[a-z.]+$/i;

/**
 * Company name → its own domain, cheapest first: one Serper query (~$0.001), then Exa (~$0.005).
 * The first organic result that is not a directory wins; null when nothing credible comes back.
 */
export async function resolveDomain(ctx: PlayCtx, name: string, hint = ''): Promise<{ domain: string; via: string } | null> {
  const pick = (urls: string[]) => urls.map((u) => apexDomain(u)).find((d): d is string => !!d && !NOT_A_COMPANY.test(d));
  if (canRun(ctx, 'serper')) {
    const rc = await callLeg(ctx, 'resolve_domain:serper', 'serper', 'google_search', { q: `${name} ${hint} site officiel`.trim(), num: 5 });
    const d = pick(((rc?.output as any)?.results ?? []).map((r: any) => r.link));
    if (d) return { domain: d, via: 'serper' };
  }
  if (canRun(ctx, 'exa')) {
    const rc = await callLeg(ctx, 'resolve_domain:exa', 'exa', 'search', { query: `${name} official website`, numResults: 3 });
    const d = pick(((rc?.output as any)?.results ?? []).map((r: any) => r.url));
    if (d) return { domain: d, via: 'exa' };
  }
  return null;
}
