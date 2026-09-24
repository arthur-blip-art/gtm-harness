import type { Model, Observation } from './scoring-contract.ts';
import type { CompanyRow, Signal } from '../store/store.ts';

/**
 * Rules-based observation builders for the two account dimensions. These are EXPLORATORY models
 * with hand-set weights, never learned from phrase counts: every reason is auditable.
 * Chift default ICP: European B2B SaaS, 20–500 people, software/fintech, integration hunger.
 */
export const DEFAULT_FIT_MODEL: Model = {
  id: 'chift-account-fit-v1', dimension: 'account_fit', intercept: 0, validation: 'exploratory',
  weights: { headcount_band: 3, industry_software: 2, country_target: 1, tech_integration_signal: 1 },
  max_age_days: { headcount_band: 365, industry_software: 365, country_target: 365, tech_integration_signal: 365 },
};
export const DEFAULT_ENGAGEMENT_MODEL: Model = {
  id: 'chift-account-engagement-v1', dimension: 'account_engagement', intercept: 0, validation: 'exploratory', event_window_days: 180,
  weights: { funding_recent: 3, job_openings_90d: 2, headcount_growth: 1, integration_job_openings: 2 },
  max_age_days: { funding_recent: 180, job_openings_90d: 90, headcount_growth: 180, integration_job_openings: 90 },
};

const TARGET_COUNTRIES = /^(fr|france|be|belgium|belgique|nl|netherlands|es|spain|espagne|de|germany|allemagne|uk|gb|united kingdom|it|italy|pt|portugal|lu|luxembourg|ch|switzerland)$/i;
const SOFTWARE = /software|saas|fintech|internet|information technology|it services|computer|cloud|platform|payments|e-?commerce|hospitality tech/i;
const INTEGRATION_TECH = /salesforce|hubspot|segment|zapier|stripe|shopify|pennylane|sage|odoo|exact|cegid|quickbooks|xero|netsuite|merge|codat|apideck|rutter/i;
const INTEGRATION_JOB = /integration|api|partnership|connector|platform|ecosystem/i;

/** Observations must be retrieved strictly before the scoring instant. */
export const retrievedBefore = (now: string) => new Date(Date.parse(now) - 1000).toISOString();

const ts = (d?: string) => (d ? `${d.length === 10 ? `${d}T00:00:00` : d}${/Z|[+-]\d\d:\d\d$/.test(d) ? '' : 'Z'}` : undefined);

export function fitObservations(c: CompanyRow, now: string): Observation[] {
  const retrieved = retrievedBefore(now);
  const enrichedAt = c.raw && typeof (c.raw as any).enriched_at === 'string' ? ts((c.raw as any).enriched_at)! : retrieved;
  const known = Date.parse(enrichedAt) > Date.parse(retrieved) ? retrieved : enrichedAt; // enriched in the same second as scoring → clamp
  const base = { entity_id: c.domain, dimension: 'account_fit' as const, source_class: 'external' as const, known_at: known, event_at: known, retrieved_at: retrievedBefore(now), status: 'observed' as const };
  const obs: Observation[] = [];
  obs.push({ ...base, feature: 'headcount_band', source_id: c.fieldSources.headcount ?? 'companies.headcount', value: c.headcount == null ? null : c.headcount >= 20 && c.headcount <= 500 ? 1 : c.headcount > 500 && c.headcount <= 2000 ? 0.5 : 0, status: c.headcount == null ? 'missing' : 'observed' });
  obs.push({ ...base, feature: 'industry_software', source_id: c.fieldSources.industry ?? 'companies.industry', value: c.industry ? (SOFTWARE.test(c.industry) ? 1 : 0) : null, status: c.industry ? 'observed' : 'missing' });
  obs.push({ ...base, feature: 'country_target', source_id: c.fieldSources.country ?? 'companies.country', value: c.country ? (TARGET_COUNTRIES.test(c.country.trim()) ? 1 : 0) : null, status: c.country ? 'observed' : 'missing' });
  const tech = c.tech ?? [];
  obs.push({ ...base, feature: 'tech_integration_signal', source_id: c.fieldSources.tech ?? 'companies.tech', value: tech.length ? (tech.some((t) => INTEGRATION_TECH.test(t)) ? 1 : 0) : null, status: tech.length ? 'observed' : 'missing' });
  return obs;
}

export function engagementObservations(c: CompanyRow, signals: Signal[], now: string): Observation[] {
  const nowMs = Date.parse(now);
  const base = { entity_id: c.domain, dimension: 'account_engagement' as const, source_class: 'first_party_event' as const, retrieved_at: retrievedBefore(now), status: 'observed' as const };
  const mine = signals.filter((s) => s.domain === c.domain);
  const obs: Observation[] = [];
  const funding = mine.filter((s) => s.type === 'funding_round').sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''))[0];
  const fundingDate = ts(funding?.observedAt ?? c.fundingLastDate);
  if (fundingDate) {
    const days = (nowMs - Date.parse(fundingDate)) / 86400000;
    obs.push({ ...base, feature: 'funding_recent', source_id: funding?.source ?? c.fieldSources.fundingLastDate ?? 'companies.funding_last_date', value: days <= 180 ? 1 : 0, known_at: fundingDate, event_at: fundingDate });
  } else obs.push({ ...base, feature: 'funding_recent', source_id: 'none', value: null, known_at: base.retrieved_at, event_at: base.retrieved_at, status: 'missing' });

  const jobs = mine.filter((s) => s.type === 'job_opening' && s.observedAt && nowMs - Date.parse(s.observedAt) <= 90 * 86400000);
  const latestJob = jobs.map((j) => j.observedAt!).sort().pop();
  obs.push({ ...base, feature: 'job_openings_90d', source_id: jobs[0]?.source ?? 'signals.job_opening', value: jobs.length ? Math.min(jobs.length, 5) / 5 : 0, known_at: ts(latestJob) ?? base.retrieved_at, event_at: ts(latestJob) ?? base.retrieved_at });
  const integ = jobs.filter((j) => INTEGRATION_JOB.test(String((j.value as any).title ?? '')));
  obs.push({ ...base, feature: 'integration_job_openings', source_id: integ[0]?.source ?? 'signals.job_opening', value: integ.length ? 1 : 0, known_at: ts(latestJob) ?? base.retrieved_at, event_at: ts(latestJob) ?? base.retrieved_at });

  const growth = mine.filter((s) => s.type === 'headcount_growth').sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''))[0];
  if (growth) {
    const pct = Number((growth.value as any).pct ?? 0);
    obs.push({ ...base, feature: 'headcount_growth', source_id: growth.source, value: Math.max(-1, Math.min(1, pct / 50)), known_at: ts(growth.observedAt)!, event_at: ts(growth.observedAt)! });
  } else obs.push({ ...base, feature: 'headcount_growth', source_id: 'none', value: null, known_at: base.retrieved_at, event_at: base.retrieved_at, status: 'missing' });
  return obs;
}
