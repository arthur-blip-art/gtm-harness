/**
 * Turns a dated headline or announcement into a typed signal: what happened (the situation) and
 * when (the timing). Free, deterministic, bilingual EN/FR; the LLM is not needed to tell a
 * funding round from a product launch. Shelf lives say how long a signal is a reason to write.
 */
export type SignalType =
  | 'funding_round' | 'leadership_change' | 'product_launch' | 'expansion' | 'acquisition'
  | 'partnership' | 'layoffs' | 'award' | 'job_opening' | 'headcount_growth' | 'mention' | 'job_change';

export const SHELF_LIFE_DAYS: Record<string, number> = {
  funding_round: 180, leadership_change: 90, product_launch: 60, expansion: 365, acquisition: 180,
  partnership: 90, layoffs: 90, award: 60, job_opening: 45, headcount_growth: 180, mention: 30, job_change: 90,
  linkedin_keyword_post: 21, linkedin_competitor_engagement: 21, linkedin_tracked_post: 21,
};

const RULES: Array<[SignalType, RegExp]> = [
  ['acquisition', /\b(acquires?|acquired|acquisition of|rach[eè]te|rachat|acquiert|fusion|merger)\b/i],
  ['funding_round', /\b(raises?|raised|secures?|closes?)\b.*\b(\$|€|£|million|m\b|bn|billion|seed|series [a-f])|\b(series [a-f]|seed round|pre-seed|funding round|lève|lev[ée]e de fonds|tour de table|millions? d.euros)\b/i],
  ['layoffs', /\b(layoffs?|lays off|laid off|cuts? \d+ jobs|job cuts|licenciements?|plan social)\b/i],
  ['leadership_change', /\b(appoints?|appointed|names|named|hires|joins as|new (ceo|cto|cfo|cmo|cro|cpo|coo|vp)|nomm[ée]e?|nomination|rejoint .* en tant que|nouveau (dg|directeur|pdg))\b/i],
  ['expansion', /\b(expands? (to|into)|launch(es)? in|opens? (an )?(office|hub)|enters? the .* market|international expansion|s.implante|ouvre un bureau|expansion (en|aux))\b/i],
  ['product_launch', /\b(launch(es|ed)?|unveils?|introduces?|announces? (the )?(new|general availability)|now available|lance|d[ée]voile|nouvelle (offre|fonctionnalit[ée]))\b/i],
  ['partnership', /\b(partners? with|partnership|teams up|integration with|s.associe|partenariat)\b/i],
  ['award', /\b(award|wins?|named (a |to )|ranked|top \d+|lauréat|prix)\b/i],
];

export function classifyHeadline(title: string): SignalType | null {
  for (const [type, re] of RULES) if (re.test(title)) return type;
  return null;
}

/** "$25M", "€12 million", "25 millions d'euros" → amount in units of the currency. */
export function parseAmount(s: string): { amount: number; currency: string } | null {
  const m = /(\$|€|£|usd|eur|gbp)?\s?(\d+(?:[.,]\d+)?)\s?(m|mn|million|millions|bn|billion|milliards?|k)\b\s?(d.euros|euros?|dollars?)?/i.exec(s);
  if (!m) return null;
  const n = Number(m[2].replace(',', '.'));
  const unit = m[3].toLowerCase();
  const mult = unit.startsWith('b') || unit.startsWith('milliard') ? 1e9 : unit === 'k' ? 1e3 : 1e6;
  const cur = (m[1] ?? m[4] ?? '').toLowerCase();
  const currency = cur.includes('€') || cur.includes('eur') ? 'EUR' : cur.includes('£') || cur === 'gbp' ? 'GBP' : 'USD';
  return { amount: n * mult, currency };
}

export function roundOf(s: string): string | null {
  return /\b(pre-seed|seed|series [a-f])\b/i.exec(s)?.[1]?.replace(/\b\w/g, (c) => c.toUpperCase()) ?? null;
}

/** Is the signal still a reason to write today? */
export function isFresh(type: string, observedAt: string | undefined, now = Date.now()): boolean {
  if (!observedAt) return false;
  const days = (now - Date.parse(observedAt)) / 86400000;
  return days >= 0 && days <= (SHELF_LIFE_DAYS[type] ?? 60);
}

/** Does the headline actually talk about this company (name match), not a namesake? */
export function mentionsCompany(title: string, name: string): boolean {
  const n = name.toLowerCase().replace(/\b(sas|sa|inc|ltd|gmbh|bv|srl|limited|corp|corporation|technologies|labs?)\b\.?/g, '').trim();
  if (n.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(title);
}

/** Weight of a fresh signal when ranking accounts for outreach timing (prospect). Transparent, hand-set. */
export const TIMING_WEIGHT: Record<string, number> = {
  job_change: 4, funding_round: 3, leadership_change: 3, acquisition: 2, expansion: 2, product_launch: 1, partnership: 1,
  linkedin_competitor_engagement: 2, linkedin_tracked_post: 1, linkedin_keyword_post: 1, headcount_growth: 1, job_opening: 0.4, layoffs: -2,
};

/** Sum of fresh signal weights, each type counted once except jobs (capped at 5). */
export function timingScore(signals: Array<{ type: string; observedAt?: string }>, now = Date.now()): { score: number; reasons: string[] } {
  const fresh = signals.filter((s) => isFresh(s.type, s.observedAt, now));
  const byType = new Map<string, number>();
  for (const s of fresh) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
  let score = 0;
  const reasons: string[] = [];
  for (const [type, n] of byType) {
    const w = TIMING_WEIGHT[type] ?? 0;
    const add = type === 'job_opening' ? w * Math.min(n, 5) : w;
    if (!add) continue;
    score += add;
    reasons.push(`${type}${n > 1 ? ` x${n}` : ''}`);
  }
  return { score: Math.round(score * 10) / 10, reasons };
}
