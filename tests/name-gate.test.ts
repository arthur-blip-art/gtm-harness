import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateName, normalizeName, firstNamesMatch } from '../src/core/name-gate.ts';

const fixtures: { source_first: string; source_last: string; profile_name: string; expected_match: boolean }[] =
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'name_validation.json'), 'utf8'));

describe('LinkedIn name gate ', () => {
  it('matches every one of the 52 fixtures', () => {
    const failures = fixtures.filter((f) => validateName(f.source_first, f.source_last, f.profile_name).ok !== f.expected_match)
      .map((f) => `${f.source_first} ${f.source_last} -> ${f.profile_name} (expected ${f.expected_match})`);
    expect(failures).toEqual([]);
    expect(fixtures.length).toBe(52);
  });
  it('meets the precision/recall thresholds', () => {
    let tp = 0, fp = 0, fn = 0;
    for (const f of fixtures) {
      const got = validateName(f.source_first, f.source_last, f.profile_name).ok;
      if (f.expected_match && got) tp++;
      if (!f.expected_match && got) fp++;
      if (f.expected_match && !got) fn++;
    }
    expect(tp / (tp + fp)).toBeGreaterThanOrEqual(0.95);
    expect(tp / (tp + fn)).toBeGreaterThanOrEqual(0.85);
  });
  it('normalizes accents and nicknames', () => {
    expect(normalizeName('Chloé Ô')).toBe('chloe o');
    expect(firstNamesMatch('Bob', 'Robert')).toEqual([true, 'nickname']);
    expect(firstNamesMatch('J', 'James')).toEqual([true, 'initial']);
    expect(validateName('Mike', 'Smith', 'Michael "Mike" Smith-Jones').ok).toBe(true);
    expect(validateName('Ana', 'Lopez', 'Julie Ho').ok).toBe(false);
  });
});
