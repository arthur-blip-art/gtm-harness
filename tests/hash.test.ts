import { describe, expect, it } from 'vitest';
import { canonical, hashInput } from '../src/core/hash.ts';

describe('hash', () => {
  it('is stable across key order and undefined', () => {
    expect(hashInput({ a: 1, b: { c: [1, 2] } })).toBe(hashInput({ b: { c: [1, 2] }, a: 1, z: undefined }));
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('changes on any value change', () => {
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: '1' }));
  });
});
