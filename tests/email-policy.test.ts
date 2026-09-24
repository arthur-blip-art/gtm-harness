import { describe, expect, it } from 'vitest';
import { canonicalStatus, checkDomain, decide } from '../src/core/email-policy.ts';

describe('email policy', () => {
  it('maps provider statuses', () => {
    expect(canonicalStatus('apollo', 'verified')).toBe('valid');
    expect(canonicalStatus('apollo', 'guessed')).toBe('unknown');
    expect(canonicalStatus('fullenrich', 'DELIVERABLE')).toBe('valid');
    expect(canonicalStatus('fullenrich', 'CATCH_ALL')).toBe('catch_all');
    expect(canonicalStatus('hunter', 'accept_all')).toBe('catch_all');
    expect(canonicalStatus('zerobounce', 'catch-all')).toBe('catch_all');
    expect(canonicalStatus('nobody', 'weird')).toBe('unknown');
  });
  it('rejects domain mismatch', () => {
    expect(checkDomain('a@chift.eu', 'https://www.chift.eu/')).toEqual({ ok: true });
    expect(checkDomain('a@gmail.com', 'chift.eu')).toEqual({ ok: false, reason: 'domain_mismatch' });
  });
  it('decides by precedence', () => {
    expect(decide([{ value: 'a@x.com', status: 'unknown', source: 'apollo' }, { value: 'a@x.com', status: 'valid', source: 'fullenrich' }], 2))
      .toMatchObject({ value: 'a@x.com', source: 'fullenrich', confidence: 'HIGH', missReason: null });
    expect(decide([{ value: 'a@x.com', status: 'catch_all', source: 'apollo' }, { value: 'a@x.com', status: 'catch_all', source: 'fullenrich' }], 2))
      .toMatchObject({ confidence: 'MEDIUM', status: 'catch_all' });
    // the second validator counts as an independent source; MillionVerifier's own verdict does not
    expect(decide([{ value: 'a@x.com', status: 'catch_all', source: 'fullenrich' }, { value: 'a@x.com', status: 'catch_all', source: 'fullenrich+verify' }], 2)).toMatchObject({ confidence: 'HOLD' });
    expect(decide([{ value: 'a@x.com', status: 'catch_all', source: 'fullenrich' }, { value: 'a@x.com', status: 'catch_all', source: 'fullenrich+zerobounce' }], 2)).toMatchObject({ confidence: 'MEDIUM' });
    expect(decide([{ value: 'a@x.com', status: 'catch_all', source: 'apollo' }], 2)).toMatchObject({ confidence: 'HOLD', value: 'a@x.com' });
    expect(decide([{ value: 'a@x.com', status: 'invalid', source: 'apollo' }], 2)).toMatchObject({ value: null, missReason: 'invalid_only' });
    expect(decide([], 3)).toMatchObject({ value: null, missReason: 'no_match_all_legs' });
    expect(decide([], 0)).toMatchObject({ missReason: 'no_legs_enabled' });
  });
});
