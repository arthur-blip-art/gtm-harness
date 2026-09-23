import { describe, expect, it } from 'vitest';
import { apexDomain, nameToken, normalizeEmail, normalizeLinkedin, isSalesNavUrl } from '../src/core/normalize.ts';
import { personKey } from '../src/core/keys.ts';

describe('normalize', () => {
  it('apex domain from url, host, email', () => {
    expect(apexDomain('https://www.chift.eu/')).toBe('chift.eu');
    expect(apexDomain('app.pennylane.com')).toBe('pennylane.com');
    expect(apexDomain('  Mail@Sub.Example.co.uk ')).toBe('example.co.uk');
    expect(apexDomain('')).toBeNull();
  });
  it('name tokens strip accents and punctuation', () => {
    expect(nameToken(' Chloé ')).toBe('chloe');
    expect(nameToken("O'Brien")).toBe('obrien');
  });
  it('emails and linkedin', () => {
    expect(normalizeEmail(' A@B.com ')).toBe('a@b.com');
    expect(normalizeLinkedin('https://fr.linkedin.com/in/jane-doe/?x=1')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(isSalesNavUrl('https://www.linkedin.com/sales/lead/ACwAAA,NAME')).toBe(true);
  });
  it('personKey precedence and stability', () => {
    expect(personKey({ first_name: 'A', last_name: 'B', domain: 'x.com', linkedin_url: 'linkedin.com/in/ab' })).toBe('li:ab');
    expect(personKey({ first_name: 'A', last_name: 'B', email: 'a@x.com' })).toBe('em:a@x.com');
    const k1 = personKey({ first_name: 'Chloé', last_name: 'Xavier', domain: 'https://www.qonto.com' });
    const k2 = personKey({ first_name: 'chloe', last_name: 'XAVIER', domain: 'qonto.com' });
    expect(k1).toBe(k2);
    expect(k1.startsWith('nm:')).toBe(true);
  });
});
