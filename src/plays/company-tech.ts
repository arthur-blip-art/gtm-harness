import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { sha256 } from '../core/hash.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta, RowState } from '../core/types.ts';
import type { Signal } from '../store/store.ts';
import { BatchInput, type BatchOutput } from '../core/row-play.ts';

export const NAME = 'company-tech';
export const DESCRIPTION = 'Free tech stack from the company website (scripts, links, "powered by") and DNS (MX/TXT): CRM, marketing automation, support, billing, mail, competitor widgets. Writes companies.tech (feeds the fit score) and tech_stack / competitor_detected signals.';

export const Input = z.object({
  domain: z.string().min(1),
  paths: z.array(z.string()).default(['', '/integrations']).describe('pages fetched under https://<domain>; "powered by" widgets live on integration pages'),
});
export type Input = z.infer<typeof Input>;
export interface Output { domain: string; tech: string[]; competitors: string[]; evidence: Record<string, string>; signals: Signal[]; inserted: number; sources: Record<string, string> }

type Where = 'script' | 'link' | 'text' | 'generator' | 'mx' | 'txt';
interface Signature { tech: string; category: string; competitor?: boolean; where: Where[]; re: RegExp }

/**
 * Signature table. Script and DNS evidence is strong; text only for explicit "powered by" or a
 * named accounting integration (an integrations page listing Pennylane says they integrate it).
 */
export const SIGNATURES: Signature[] = [
  { tech: 'HubSpot', category: 'crm', where: ['script'], re: /js\.hs-scripts\.com|js\.hs-analytics\.net|js\.hsforms\.net|js\.hubspot\.com|js\.hs-banner\.com/ },
  { tech: 'HubSpot', category: 'crm', where: ['txt'], re: /hubspot-developer-verification|hubspotemail\.net/ },
  { tech: 'Salesforce', category: 'crm', where: ['txt'], re: /_spf\.salesforce\.com|salesforce-verification|sfdc/i },
  { tech: 'Pardot', category: 'marketing_automation', where: ['script', 'txt'], re: /pardot\.com|pi\.pardot/ },
  { tech: 'Marketo', category: 'marketing_automation', where: ['script', 'txt'], re: /munchkin\.marketo\.net|mktomail\.com|marketo\.com/ },
  { tech: 'Intercom', category: 'support', where: ['script'], re: /widget\.intercom\.io|js\.intercomcdn\.com/ },
  { tech: 'Zendesk', category: 'support', where: ['script', 'link', 'txt'], re: /static\.zdassets\.com|\.zendesk\.com/ },
  { tech: 'Segment', category: 'analytics', where: ['script'], re: /cdn\.segment\.com|cdn\.segment\.io/ },
  { tech: 'Stripe', category: 'billing', where: ['script'], re: /js\.stripe\.com/ },
  { tech: 'Chargebee', category: 'billing', where: ['script', 'link'], re: /js\.chargebee\.com|\.chargebee\.com/ },
  { tech: 'Shopify', category: 'cms', where: ['script', 'generator'], re: /cdn\.shopify\.com|shopify/i },
  { tech: 'Webflow', category: 'cms', where: ['script', 'generator'], re: /webflow/i },
  { tech: 'WordPress', category: 'cms', where: ['script', 'generator'], re: /wordpress|wp-content|wp-includes/i },
  { tech: 'Google Workspace', category: 'mail', where: ['mx'], re: /google\.com$|googlemail\.com$/ },
  { tech: 'Microsoft 365', category: 'mail', where: ['mx'], re: /mail\.protection\.outlook\.com$/ },
  { tech: 'Mailchimp', category: 'email_marketing', where: ['script', 'link', 'txt'], re: /chimpstatic\.com|list-manage\.com|servers\.mcsv\.net|mailchimp/ },
  { tech: 'SendGrid', category: 'email_delivery', where: ['txt'], re: /sendgrid\.net/ },
  { tech: 'Pennylane', category: 'accounting_integration', where: ['link', 'text'], re: /pennylane/i },
  { tech: 'Codat', category: 'unified_api', competitor: true, where: ['script', 'link', 'text'], re: /codat\.io|powered by codat/i },
  { tech: 'Merge', category: 'unified_api', competitor: true, where: ['script', 'link', 'text'], re: /merge\.dev|powered by merge\b/i },
  { tech: 'Apideck', category: 'unified_api', competitor: true, where: ['script', 'link', 'text'], re: /apideck\.com|powered by apideck/i },
  { tech: 'Rutter', category: 'unified_api', competitor: true, where: ['script', 'link', 'text'], re: /rutterapi\.com|rutter\.com|powered by rutter/i },
];

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);

export async function detectTech(domainRaw: string, ctx: PlayCtx, paths: string[] = ['', '/integrations']): Promise<Output> {
  const domain = apexDomain(domainRaw) ?? domainRaw;
  const sources: Record<string, string> = {};
  const hay: Record<Where, Array<{ s: string; url: string }>> = { script: [], link: [], text: [], generator: [], mx: [], txt: [] };
  const receipts: string[] = [];
  const call = async (leg: string, tool: string, input: Record<string, unknown>) => {
    const meta: LegMeta = { leg, provider: 'web', tool, rowsReached: 0, accepted: 0, receiptIds: [] };
    ctx.metas.push(meta);
    if (!legEnabled(ctx, 'web', leg)) { sources[leg] = 'skipped'; return null; }
    meta.rowsReached = 1;
    const rc = await ctx.runner.execute({ provider: 'web', tool, input, runId: ctx.runId });
    meta.receiptIds!.push(rc.id);
    receipts.push(rc.id);
    if (!rc.cached) ctx.spent.credits += rc.costCredits;
    sources[leg] = rc.status;
    if (rc.status !== 'hit') return null;
    meta.accepted = 1;
    return (rc.output as any) ?? {};
  };
  for (const p of paths) {
    const url = `https://${domain}${p}`;
    const page = await call(`page:${p || '/'}`, 'fetch_page', { url });
    if (!page) continue;
    // links to the company's own pages say nothing about its stack
    hay.link.push(...((page.links ?? []) as string[]).filter((l) => apexDomain(l) !== domain).map((s) => ({ s, url })));
    hay.script.push(...((page.scripts ?? []) as string[]).map((s) => ({ s, url })));
    if (page.text) hay.text.push({ s: String(page.text), url });
    if (page.generator) hay.generator.push({ s: String(page.generator), url });
  }
  const dns = await call('dns', 'dns', { domain });
  hay.mx.push(...((dns?.mx ?? []) as string[]).map((s) => ({ s: s.replace(/\.$/, ''), url: `dns:mx:${domain}` })));
  hay.txt.push(...((dns?.txt ?? []) as string[]).map((s) => ({ s, url: `dns:txt:${domain}` })));

  const evidence: Record<string, string> = {};
  const categories: Record<string, string> = {};
  const competitorUrls: Record<string, string> = {};
  for (const sig of SIGNATURES) {
    if (evidence[sig.tech]) continue;
    for (const w of sig.where) {
      const hit = hay[w].find((h) => sig.re.test(h.s));
      if (!hit) continue;
      evidence[sig.tech] = w === 'text' ? `${w}: "${(sig.re.exec(hit.s)?.[0] ?? '').slice(0, 60)}" on ${hit.url}` : `${w}: ${hit.s.slice(0, 160)}`;
      categories[sig.tech] = sig.category;
      if (sig.competitor) competitorUrls[sig.tech] = hit.url;
      break;
    }
  }
  const tech = Object.keys(evidence).sort();
  const competitors = Object.keys(competitorUrls).sort();
  const signals: Signal[] = [];
  const now = new Date().toISOString();
  const receiptId = receipts[0];
  if (tech.length) {
    const prev = (await ctx.store.listCompanies([domain]))[0];
    const merged = [...new Set([...(prev?.tech ?? []), ...tech])].sort(); // keep what apollo & co already found
    await ctx.store.upsertCompany({ domain, tech: merged, fieldSources: { tech: 'company-tech' }, raw: { tech_detected_at: now, tech_evidence: evidence } });
    const month = now.slice(0, 7);
    signals.push({ dedupeKey: key(domain, 'tech_stack', 'company-tech', month), domain, type: 'tech_stack', source: 'company-tech', observedAt: now, receiptId, value: { tech, categories, evidence } });
  }
  for (const c of competitors) {
    signals.push({ dedupeKey: key(domain, 'competitor_detected', c), domain, type: 'competitor_detected', source: 'company-tech', observedAt: now, receiptId, value: { competitor: c, evidence: evidence[c], url: competitorUrls[c] } });
  }
  const inserted = await ctx.store.upsertSignals(signals);
  ctx.log(`${domain}: ${tech.join(', ') || 'nothing detected'}${competitors.length ? ` — competitor: ${competitors.join(', ')}` : ''}`);
  return { domain, tech, competitors, evidence, signals, inserted, sources };
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  run: (input, ctx) => detectTech(input.domain, ctx, input.paths),
});

export const batch = definePlay<BatchInput, BatchOutput>({
  name: `${NAME}:batch`, description: `${DESCRIPTION} (batch over a domain column)`, kind: 'batch', input: BatchInput,
  async run(input, ctx) {
    const { datasetId, rows } = await ctx
      .dataset(input.rows, { slug: input.slug, rowKey: (r) => `co:${apexDomain(r.domain) ?? r.domain}` })
      .withColumn('tech', async (row: RowState) => (row.input.domain ? await detectTech(row.input.domain, ctx) : { status: 'skipped', missReason: 'missing_domain' }), { concurrency: 4 })
      .run();
    return { rows, field: 'tech', legIds: [], datasetId };
  },
});
