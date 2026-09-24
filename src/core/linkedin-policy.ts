import type { Candidate, FieldCell, LinkedinStatus, RowState } from './types.ts';
import { normalizeLinkedin } from './normalize.ts';
import { validateName } from './name-gate.ts';
import type { FieldPolicy } from './waterfall.ts';

/**
 * A LinkedIn URL is accepted only when the profile name passes the name gate.
 * Legs pass `extra.profileName` (e.g. the search result title before " - " or " | ")
 * and `extra.companyMatch` (company token seen in title/snippet) for the confidence tier.
 */
export function decideLinkedin(candidates: Candidate<LinkedinStatus>[], legsTried: number): FieldCell<LinkedinStatus> {
  const matched = candidates.filter((c) => c.status === 'name_match');
  if (matched.length) {
    const best = matched.find((c) => c.extra?.companyMatch === true) ?? matched[0];
    return { value: best.value, status: best.status, source: best.source, confidence: best.extra?.companyMatch === true ? 'HIGH' : 'MEDIUM', missReason: null };
  }
  const held = candidates.find((c) => c.status === 'unknown');
  if (held) return { value: held.value, status: held.status, source: held.source, confidence: 'HOLD', missReason: null };
  return { value: null, status: null, source: null, confidence: 'LOW', missReason: legsTried === 0 ? 'no_legs_enabled' : 'no_match_all_legs' };
}

/** Split a search-result title like "Jane Doe - CTO - Acme | LinkedIn" into the profile name. */
export function profileNameFromTitle(title: unknown): string {
  return String(title ?? '').split(/\s[-|–]\s|\s\|\s/)[0].replace(/\s*\|?\s*LinkedIn\s*$/i, '').trim();
}

export const linkedinPolicy: FieldPolicy<LinkedinStatus> = {
  field: 'linkedin_url',
  normalize: (v) => normalizeLinkedin(v),
  canonicalStatus: (_provider, _raw, extra) => (extra?.profileName ? 'name_match' : 'unknown'),
  gate: (_value, row: RowState, extra) => {
    const profileName = String(extra?.profileName ?? '');
    if (!profileName) return { ok: false, reason: 'no_profile_name' };
    const v = validateName(row.input.first_name ?? '', row.input.last_name ?? '', profileName);
    return v.ok ? { ok: true } : { ok: false, reason: v.reason ?? 'name_mismatch' };
  },
  isAccepted: (c) => c.status === 'name_match',
  decide: decideLinkedin,
};
