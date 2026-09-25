import type { Candidate, FieldCell, PhoneStatus } from './types.ts';
import type { FieldPolicy } from './waterfall.ts';

/** Loose E.164: keep digits, `00` → `+`, require a country prefix and 8–15 digits. */
export function normalizePhone(v: unknown): string | null {
  let s = String(v ?? '').trim().replace(/[\s.\-()]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (/^\d{11,15}$/.test(s)) s = `+${s}`;
    else return null;
  }
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

const MAP: Record<string, Record<string, PhoneStatus>> = {
  lusha: { mobile: 'mobile', cell: 'mobile', direct: 'valid', work: 'valid', landline: 'valid', valid: 'valid', unknown: 'unknown' },
  kaspr: { mobile: 'mobile', direct: 'valid', work: 'valid', valid: 'valid', unknown: 'unknown' },
  leadmagic: { mobile: 'mobile', valid: 'valid', unknown: 'unknown' },
  fullenrich: { mobile: 'mobile', valid: 'valid', deliverable: 'valid', unknown: 'unknown', invalid: 'invalid' },
  mock: { mobile: 'mobile', valid: 'valid', unknown: 'unknown', invalid: 'invalid' },
};

export function canonicalPhoneStatus(provider: string, raw: unknown): PhoneStatus {
  const key = String(raw ?? '').toLowerCase().trim();
  if (!key) return 'valid';
  return MAP[provider]?.[key] ?? 'unknown';
}

/**
 * No phone validator yet (Trestle would be the natural one): a single provider hit is MEDIUM,
 * the same number from two independent sources is HIGH, unknown is HOLD.
 */
export function decidePhone(candidates: Candidate<PhoneStatus>[], legsTried: number): FieldCell<PhoneStatus> {
  const good = candidates.filter((c) => c.status === 'valid' || c.status === 'mobile');
  if (good.length) {
    const first = good[0];
    const sources = new Set(good.filter((c) => c.value === first.value).map((c) => c.source.split('+')[0]));
    return { value: first.value, status: first.status, source: first.source, confidence: sources.size >= 2 ? 'HIGH' : 'MEDIUM', missReason: null };
  }
  const held = candidates.find((c) => c.status === 'unknown');
  if (held) return { value: held.value, status: held.status, source: held.source, confidence: 'HOLD', missReason: null };
  if (candidates.length) return { value: null, status: null, source: null, confidence: 'LOW', missReason: 'invalid_only' };
  return { value: null, status: null, source: null, confidence: 'LOW', missReason: legsTried === 0 ? 'no_legs_enabled' : 'no_match_all_legs' };
}

export const phonePolicy: FieldPolicy<PhoneStatus> = {
  field: 'phone',
  normalize: normalizePhone,
  canonicalStatus: (provider, raw) => canonicalPhoneStatus(provider, raw),
  gate: () => ({ ok: true }),
  isAccepted: (c) => c.status === 'valid' || c.status === 'mobile',
  decide: decidePhone,
};
