import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { registry } from '../src/providers/index.ts';
import * as email from '../src/plays/name-domain-to-email.ts';
import * as liEmail from '../src/plays/person-linkedin-to-email.ts';
import * as phone from '../src/plays/person-to-phone.ts';
import * as linkedin from '../src/plays/person-to-linkedin.ts';
import { plays } from '../src/plays/index.ts';

const root = path.join(import.meta.dirname, '..');
const ctx = { dryRun: true, legs: undefined };
const price = (provider: string, tool: string) => registry[provider].pricing.table[tool].credits;

/** Executable contracts (pattern borrowed from Cargo's cookbook evals/contract.mjs, MIT): what every play must keep true. */
describe('play contracts', () => {
  it('email legs run cheapest-first and never include phone tools', () => {
    for (const p of [email, liEmail]) {
      const legs = p.buildLegs(ctx);
      const prices = legs.map((l) => price(l.provider, l.tool));
      for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
      expect(legs.some((l) => /phone|mobile/.test(l.tool))).toBe(false);
      expect(legs.map((l) => l.id)).toEqual(p.LEG_IDS);
    }
  });
  it('phone legs are explicit and the play warns about confidence', () => {
    expect(phone.buildLegs(ctx).every((l) => /lusha|kaspr|fullenrich/.test(l.provider))).toBe(true);
    expect(phone.DESCRIPTION).toMatch(/MEDIUM/);
  });
  it('linkedin legs end with a search fallback and every leg is a search tool', () => {
    expect(linkedin.buildLegs(ctx).every((l) => /search/.test(l.tool))).toBe(true);
  });
  it('every play has a name, description and zod input; batch variants exist for row plays', () => {
    for (const p of Object.values(plays)) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(20);
      expect(typeof p.input.parse).toBe('function');
    }
    for (const n of ['name-domain-to-email', 'person-linkedin-to-email', 'person-to-linkedin', 'person-to-phone', 'company-enrich', 'company-signals']) expect(plays[`${n}:batch`]).toBeDefined();
  });
  it('every provider has a playbook that names each of its tools, and a verifiedOn date', () => {
    for (const a of Object.values(registry)) {
      if (a.name === 'mock') continue;
      const file = path.join(root, 'provider-playbooks', `${a.name}.md`);
      expect(fs.existsSync(file), `${a.name} playbook missing`).toBe(true);
      const md = fs.readFileSync(file, 'utf8');
      for (const tool of Object.keys(a.tools)) expect(md.includes(tool), `${a.name}.md does not mention ${tool}`).toBe(true);
      expect(a.pricing.verifiedOn).toMatch(/20\d\d-\d\d-\d\d/);
      for (const tool of Object.keys(a.pricing.table)) expect(a.tools[tool], `${a.name} prices unknown tool ${tool}`).toBeDefined();
    }
  });
  it('the HubSpot sync only ever sends HIGH/MEDIUM and honours do_not_contact (source check)', () => {
    const src = fs.readFileSync(path.join(root, 'src/plays/sync-hubspot.ts'), 'utf8');
    expect(src).toMatch(/\['HIGH', 'MEDIUM'\]\.includes\(p\.confidence\)/);
    expect(src).toMatch(/!p\.doNotContact/);
  });
});
