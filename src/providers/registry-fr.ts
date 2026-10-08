import { defineAdapter, errorResult, httpJson } from './_adapter.ts';
import type { ToolResult } from '../core/types.ts';

/**
 * French public registries. Free, no key, the cheapest structural layer for French accounts:
 *   - API Recherche d'entreprises (recherche-entreprises.api.gouv.fr): companies by NAF code,
 *     department, headcount band, with their legal officers (dirigeants). For a 20-to-200 person
 *     SaaS, the CEO and founders listed there are the decision makers, at zero cost.
 *   - BODACC (opendatasoft): legal announcements per SIREN: capital increase (a funding proxy),
 *     change of officer (a new CEO), new establishment, transfer, sale.
 * Rate limit on Recherche d'entreprises: ~7 req/s. No website field: domains are resolved after.
 * Endpoints and field names: verify against the docs (api.gouv.fr, bodacc-datadila.opendatasoft.com).
 */
const PRICE = {
  search_companies: { basis: 'free', credits: 0 },
  bodacc_events: { basis: 'free', credits: 0 },
} as const;

/** NAF codes that hold most French software vendors. */
export const SAAS_NAF = ['58.29C', '58.29A', '58.29B', '62.01Z', '63.11Z', '62.02A'];

/** INSEE headcount bands (tranche_effectif_salarie) overlapping [min, max]. */
export function headcountBands(min?: number, max?: number): string[] {
  const bands: Array<[string, number, number]> = [['01', 1, 2], ['02', 3, 5], ['03', 6, 9], ['11', 10, 19], ['12', 20, 49], ['21', 50, 99], ['22', 100, 199], ['31', 200, 249], ['32', 250, 499], ['41', 500, 999], ['42', 1000, 1999], ['51', 2000, 4999], ['52', 5000, 9999], ['53', 10000, 1e9]];
  if (min === undefined && max === undefined) return [];
  return bands.filter(([, lo, hi]) => hi >= (min ?? 0) && lo <= (max ?? 1e9)).map(([c]) => c);
}
const BAND_LABEL: Record<string, string> = { '01': '1-2', '02': '3-5', '03': '6-9', '11': '10-19', '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249', '32': '250-499', '41': '500-999', '42': '1000-1999', '51': '2000-4999', '52': '5000-9999', '53': '10000+' };

export const registryFr = defineAdapter({
  name: 'registry_fr',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-08 (free public API)', table: PRICE },
  requiredEnv: [],
  tools: {
    search_companies: {
      description: 'Active French companies by NAF code / department / headcount band / free text, with officers.',
      normalize: (i) => ({
        q: String(i.q ?? '').trim(),
        naf: ((i.naf as string[] | undefined) ?? []).map(String).sort(),
        departements: ((i.departements as string[] | undefined) ?? []).map(String).sort(),
        bands: ((i.bands as string[] | undefined) ?? []).map(String).sort(),
        page: Number(i.page ?? 1),
        per_page: Math.min(Number(i.per_page ?? 25), 25),
      }),
      async execute(i, ctx): Promise<ToolResult> {
        const p = new URLSearchParams({ etat_administratif: 'A', page: String(i.page), per_page: String(i.per_page) });
        if (i.q) p.set('q', String(i.q));
        if ((i.naf as string[]).length) p.set('activite_principale', (i.naf as string[]).join(','));
        if ((i.departements as string[]).length) p.set('departement', (i.departements as string[]).join(','));
        if ((i.bands as string[]).length) p.set('tranche_effectif_salarie', (i.bands as string[]).join(','));
        const { status, body } = await httpJson(ctx, `https://recherche-entreprises.api.gouv.fr/search?${p}`);
        if (status !== 200) return errorResult(status, body, body?.erreur);
        const companies = (body?.results ?? []).map((r: any) => ({
          siren: r.siren, name: r.nom_complet ?? r.nom_raison_sociale, naf: r.activite_principale ?? r.siege?.activite_principale ?? null,
          headcount_band: BAND_LABEL[r.tranche_effectif_salarie] ?? null, created_at: r.date_creation ?? null,
          city: r.siege?.libelle_commune ?? null, postal_code: r.siege?.code_postal ?? null, country: 'FR',
          officers: (r.dirigeants ?? []).filter((d: any) => d.type_dirigeant !== 'personne morale' && d.nom).map((d: any) => ({ first_name: String(d.prenoms ?? '').split(/\s+/)[0] || null, last_name: d.nom, role: d.qualite ?? null })),
        }));
        const out = { companies, total: body?.total_results ?? null };
        return companies.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_results', output: out };
      },
      cost: () => 0,
    },
    bodacc_events: {
      description: 'BODACC announcements for a SIREN: capital changes, officer changes, establishments, sales, insolvency.',
      normalize: (i) => ({ siren: String(i.siren ?? '').replace(/\s+/g, ''), limit: Number(i.limit ?? 20) }),
      async execute(i, ctx): Promise<ToolResult> {
        const where = encodeURIComponent(`registre like "${i.siren}"`);
        const { status, body } = await httpJson(ctx, `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${where}&order_by=dateparution%20desc&limit=${i.limit}`);
        if (status !== 200) return errorResult(status, body);
        const events = (body?.results ?? []).map((r: any) => {
          let detail = '';
          try { const m = typeof r.modificationsgenerales === 'string' ? JSON.parse(r.modificationsgenerales) : r.modificationsgenerales; detail = String(m?.descriptif ?? ''); } catch { detail = String(r.modificationsgenerales ?? ''); }
          return { published_at: r.dateparution ?? null, family: r.familleavis_lib ?? null, kind: r.typeavis_lib ?? null, detail: detail.slice(0, 300), url: r.url_complete ?? null };
        });
        return events.length ? { status: 'hit', output: { siren: i.siren, events, count: events.length } } : { status: 'miss', missReason: 'no_events', output: { siren: i.siren, events: [], count: 0 } };
      },
      cost: () => 0,
    },
  },
});
