import { describe, expect, it } from 'vitest';
import { normalizePhone, decidePhone, canonicalPhoneStatus } from '../src/core/phone-policy.ts';
import { decideLinkedin, linkedinPolicy, profileNameFromTitle } from '../src/core/linkedin-policy.ts';
import type { RowState } from '../src/core/types.ts';

describe('phone policy', () => {
  it('normalizes to loose E.164', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('0033612345678')).toBe('+33612345678');
    expect(normalizePhone('0612345678')).toBeNull();
    expect(normalizePhone('33612345678')).toBe('+33612345678');
  });
  it('maps and decides', () => {
    expect(canonicalPhoneStatus('lusha', 'mobile')).toBe('mobile');
    expect(canonicalPhoneStatus('lusha', '')).toBe('valid');
    expect(decidePhone([{ value: '+336', status: 'mobile', source: 'lusha' }], 1)).toMatchObject({ confidence: 'MEDIUM' });
    expect(decidePhone([{ value: '+336', status: 'mobile', source: 'lusha' }, { value: '+336', status: 'valid', source: 'kaspr' }], 2)).toMatchObject({ confidence: 'HIGH' });
    expect(decidePhone([{ value: '+336', status: 'unknown', source: 'pdl' }], 1)).toMatchObject({ confidence: 'HOLD' });
    expect(decidePhone([], 2)).toMatchObject({ missReason: 'no_match_all_legs' });
  });
});

describe('linkedin policy', () => {
  const row: RowState = { rowKey: 'r', input: { first_name: 'Alice', last_name: 'Dupont', company: 'Chift' }, cells: {}, candidates: {} };
  it('extracts the profile name from a search title', () => {
    expect(profileNameFromTitle('Alice Dupont - CTO - Chift | LinkedIn')).toBe('Alice Dupont');
    expect(profileNameFromTitle('Alice Dupont | LinkedIn')).toBe('Alice Dupont');
  });
  it('gates on the name and grades on company match', () => {
    expect(linkedinPolicy.gate('https://www.linkedin.com/in/alice-dupont', row, { profileName: 'Alice Dupont' })).toEqual({ ok: true });
    expect(linkedinPolicy.gate('https://www.linkedin.com/in/julie-ho', row, { profileName: 'Julie Ho' })).toMatchObject({ ok: false });
    expect(linkedinPolicy.gate('https://www.linkedin.com/in/x', row, {})).toMatchObject({ ok: false, reason: 'no_profile_name' });
    expect(decideLinkedin([{ value: 'u', status: 'name_match', source: 'serper', extra: { companyMatch: true } }], 1)).toMatchObject({ confidence: 'HIGH' });
    expect(decideLinkedin([{ value: 'u', status: 'name_match', source: 'serper', extra: { companyMatch: false } }], 1)).toMatchObject({ confidence: 'MEDIUM' });
  });
});
