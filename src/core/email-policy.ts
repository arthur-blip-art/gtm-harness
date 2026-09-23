import type { Confidence, EmailCandidate, EmailCell, EmailStatus } from './types.ts';
import { apexDomain, normalizeEmail } from './normalize.ts';

/**
 * Provider raw status → canonical status.
 * Anything unrecognised is `unknown` (held, never sent, never dropped).
 */
const MAP: Record<string, Record<string, EmailStatus>> = {
  apollo: { verified: 'valid', likely_to_engage: 'valid', guessed: 'unknown', extrapolated: 'unknown', unverified: 'unknown', unavailable: 'invalid' },
  fullenrich: { deliverable: 'valid', high_probability: 'unknown', catch_all: 'catch_all', invalid: 'invalid', unknown: 'unknown' },
  millionverifier: { ok: 'valid', catch_all: 'catch_all', unknown: 'unknown', invalid: 'invalid', disposable: 'disposable' },
  peopledatalabs: { valid: 'valid', 'valid-catch_all': 'catch_all', catch_all: 'catch_all', unknown: 'unknown', invalid: 'invalid' },
  crustdata: { verified: 'valid', valid: 'valid', catch_all: 'catch_all', unknown: 'unknown', invalid: 'invalid' },
  pattern: { ok: 'valid', catch_all: 'catch_all', unknown: 'unknown', invalid: 'invalid', disposable: 'disposable' },
  mock: { valid: 'valid', catch_all: 'catch_all', unknown: 'unknown', invalid: 'invalid' },
};

export function canonicalStatus(provider: string, raw: unknown): EmailStatus {
  const key = String(raw ?? '').toLowerCase().trim();
  return MAP[provider]?.[key] ?? 'unknown';
}

export type DomainCheck = { ok: true } | { ok: false; reason: 'domain_mismatch' | 'bad_email' };

/** The email's apex must equal the row's company apex. A mismatch is a strong wrong-person signal. */
export function checkDomain(email: string, rowDomain: unknown): DomainCheck {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, reason: 'bad_email' };
  const want = apexDomain(rowDomain);
  const got = apexDomain(e);
  if (!want || !got) return { ok: false, reason: 'bad_email' };
  return want === got ? { ok: true } : { ok: false, reason: 'domain_mismatch' };
}

/** Does this candidate end the waterfall for the row? Only a `valid` does. */
export function isAccepted(c: EmailCandidate): boolean {
  return c.status === 'valid';
}

/**
 * Final decision after the last leg. Precedence, not averaging:
 *  valid (first in leg order)            → HIGH
 *  catch_all agreed by 2+ sources        → MEDIUM
 *  catch_all or unknown from one source  → HOLD (kept, not sendable)
 *  only invalid/disposable               → null, miss_reason=invalid_only
 *  nothing                               → null, miss_reason=no_match_all_legs
 */
export function decide(candidates: EmailCandidate[], legsTried: number): EmailCell {
  const valid = candidates.find((c) => c.status === 'valid');
  if (valid) return cell(valid, 'HIGH');

  const catchAll = candidates.filter((c) => c.status === 'catch_all');
  const byEmail = new Map<string, Set<string>>();
  for (const c of catchAll) {
    const set = byEmail.get(c.email) ?? new Set<string>();
    set.add(c.source);
    byEmail.set(c.email, set);
  }
  for (const c of catchAll) {
    if ((byEmail.get(c.email)?.size ?? 0) >= 2) return cell(c, 'MEDIUM');
  }
  const held = candidates.find((c) => c.status === 'catch_all' || c.status === 'unknown');
  if (held) return cell(held, 'HOLD'); // value kept, not sendable; confidence carries the hold

  if (candidates.length > 0) return empty('invalid_only');
  return empty(legsTried === 0 ? 'no_legs_enabled' : 'no_match_all_legs');
}

function cell(c: EmailCandidate, confidence: Confidence): EmailCell {
  return { value: c.email, status: c.status, source: c.source, confidence, missReason: null };
}

function empty(reason: string): EmailCell {
  return { value: null, status: null, source: null, confidence: 'LOW', missReason: reason };
}
