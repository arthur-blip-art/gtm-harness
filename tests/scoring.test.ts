import { describe, expect, it } from 'vitest';
import { scoreRow, gradePercentile, type Model, type Observation, type Reference } from '../src/core/scoring-contract.ts';
import { fitObservations, engagementObservations, DEFAULT_FIT_MODEL, DEFAULT_ENGAGEMENT_MODEL } from '../src/core/scoring-rules.ts';

const now = '2026-09-24T10:00:00Z';
const model: Model = { id: 'm', dimension: 'account_fit', intercept: 0, weights: { a: 2, b: 1 }, max_age_days: { a: 30, b: 30 }, validation: 'exploratory' };
const ref: Reference = { id: 'r', model_id: 'm', dimension: 'account_fit', scores: [0, 1, 2, 3], population: 'test', frozen_at: '2026-09-24T09:00:00Z' };
const obs = (feature: string, value: number, event = '2026-09-20T00:00:00Z'): Observation => ({ entity_id: 'x', feature, value, dimension: 'account_fit', source_class: 'external', source_id: 's', known_at: event, event_at: event, retrieved_at: '2026-09-21T00:00:00Z', status: 'observed' });

describe('scoring contract (port)', () => {
  it('grades by percentile bands', () => {
    expect(gradePercentile(95)).toBe('A');
    expect(gradePercentile(80)).toBe('B');
    expect(gradePercentile(60)).toBe('C');
    expect(gradePercentile(10)).toBe('D');
  });
  it('scores when every feature has exactly one fresh observation', () => {
    const r = scoreRow('x', now, [obs('a', 1), obs('b', 1)], model, ref);
    expect(r.score).toBe(3);
    expect(r.grade).toBe('B'); // percentile 87.5 with midrank ties on [0,1,2,3]
    expect(r.status).toBe('scored');
  });
  it('refuses stale or ambiguous evidence with a reason', () => {
    expect(scoreRow('x', now, [obs('a', 1, '2026-01-01T00:00:00Z'), obs('b', 1)], model, ref).miss_reason).toBe('a:stale_event');
    expect(scoreRow('x', now, [obs('a', 1), obs('a', 0), obs('b', 1)], model, ref).miss_reason).toBe('a:ambiguous_observation');
    expect(scoreRow('x', now, [obs('b', 1)], model, ref).miss_reason).toBe('a:no_matching_observation');
  });
});

describe('scoring rules', () => {
  const company = { id: '1', domain: 'chift.eu', headcount: 120, industry: 'software', country: 'France', tech: ['Salesforce'], fieldSources: {}, raw: { enriched_at: '2026-09-01T00:00:00Z' } };
  it('builds fit observations from the golden record', () => {
    const o = fitObservations(company, now);
    expect(Object.fromEntries(o.map((x) => [x.feature, x.value]))).toEqual({ headcount_band: 1, industry_software: 1, country_target: 1, tech_integration_signal: 1 });
    const ref: Reference = { id: 'r', model_id: DEFAULT_FIT_MODEL.id, dimension: 'account_fit', scores: [0, 3, 7], population: 'p', frozen_at: '2026-09-24T09:00:00Z' };
    expect(scoreRow('chift.eu', now, o, DEFAULT_FIT_MODEL, ref)).toMatchObject({ score: 7, grade: 'B' });
  });
  it('builds engagement observations from signals', () => {
    const signals = [
      { dedupeKey: '1', domain: 'chift.eu', type: 'funding_round', value: { round: 'Series A' }, source: 'predictleads', observedAt: '2026-08-15T00:00:00Z' },
      { dedupeKey: '2', domain: 'chift.eu', type: 'job_opening', value: { title: 'Integration Engineer' }, source: 'predictleads', observedAt: '2026-09-01T00:00:00Z' },
    ];
    const o = engagementObservations(company, signals, now);
    const v = Object.fromEntries(o.map((x) => [x.feature, x.value]));
    expect(v).toMatchObject({ funding_recent: 1, job_openings_90d: 0.2, integration_job_openings: 1, headcount_growth: null });
    const ref: Reference = { id: 'r', model_id: DEFAULT_ENGAGEMENT_MODEL.id, dimension: 'account_engagement', scores: [0, 2, 5], population: 'p', frozen_at: '2026-09-24T09:00:00Z' };
    expect(scoreRow('chift.eu', now, o, DEFAULT_ENGAGEMENT_MODEL, ref).miss_reason).toBe('headcount_growth:missing_value_or_source');
  });
});
