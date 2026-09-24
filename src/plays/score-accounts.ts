import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { scoreRow, type Model, type Reference } from '../core/scoring-contract.ts';
import { DEFAULT_ENGAGEMENT_MODEL, DEFAULT_FIT_MODEL, engagementObservations, fitObservations } from '../core/scoring-rules.ts';
import type { Score } from '../store/store.ts';
import type { LegMeta } from '../core/types.ts';

export const NAME = 'score-accounts';
export const DESCRIPTION = 'Rules-based account_fit and account_engagement from companies + signals (no provider calls). Reference = the scored population, frozen at run start.';

export const Input = z.object({
  domains: z.array(z.string()).optional().describe('defaults to every company in the store'),
  model: z.string().default('chift-v1'),
  since: z.string().optional().describe('ISO date: ignore signals before'),
});
export type Input = z.infer<typeof Input>;
export interface Output { model: string; scored: number; unscored: number; scores: Score[] }

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const now = new Date().toISOString();
    const companies = await ctx.store.listCompanies(input.domains);
    const signals = await ctx.store.listSignals(companies.map((c) => c.domain), input.since);
    const meta: LegMeta = { leg: 'score', provider: 'local', tool: 'scoring-contract', rowsReached: companies.length, accepted: 0, receiptIds: [] };
    ctx.metas.push(meta);

    const dims: Array<[Model, (c: (typeof companies)[number]) => ReturnType<typeof fitObservations>]> = [
      [{ ...DEFAULT_FIT_MODEL, id: `${input.model}:fit` }, (c) => fitObservations(c, now)],
      [{ ...DEFAULT_ENGAGEMENT_MODEL, id: `${input.model}:engagement` }, (c) => engagementObservations(c, signals, now)],
    ];
    const scores: Score[] = [];
    let scored = 0, unscored = 0;
    for (const [model, build] of dims) {
      // pass 1: raw scores for the reference population (frozen before grading)
      const obsByDomain = new Map(companies.map((c) => [c.domain, build(c)]));
      const rawScores: number[] = [];
      const probe: Reference = { id: 'probe', model_id: model.id, dimension: model.dimension, scores: [0, 1], population: 'probe', frozen_at: new Date(Date.parse(now) - 2000).toISOString() };
      for (const c of companies) {
        const r = scoreRow(c.domain, now, obsByDomain.get(c.domain)!, model, probe);
        if (r.score !== null) rawScores.push(r.score);
      }
      const reference: Reference = { id: `${model.id}:${now}`, model_id: model.id, dimension: model.dimension, scores: rawScores.length ? rawScores : [0, 1], population: `${companies.length} companies`, frozen_at: new Date(Date.parse(now) - 1000).toISOString() };
      // pass 2: grade against the frozen reference
      for (const c of companies) {
        const r = scoreRow(c.domain, now, obsByDomain.get(c.domain)!, model, reference);
        const s: Score = { domain: c.domain, model: input.model, dimension: model.dimension, score: r.score, tier: r.grade, reasons: r.evidence.map((e) => ({ feature: e.feature, value: e.value, source: e.source_id })), inputs: r.enriched, missReason: r.miss_reason };
        if (r.score !== null) scored++; else unscored++;
        scores.push(s);
        await ctx.store.upsertScore(s);
      }
    }
    meta.accepted = scored;
    return { model: input.model, scored, unscored, scores };
  },
});
