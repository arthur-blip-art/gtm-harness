import type { Adapter } from '../core/types.ts';
import { env } from '../config.ts';
import { apollo } from './apollo.ts';
import { crustdata } from './crustdata.ts';
import { exa } from './exa.ts';
import { fullenrich } from './fullenrich.ts';
import { millionverifier } from './millionverifier.ts';
import { mock } from './mock.ts';
import { parallel } from './parallel.ts';
import { peopledatalabs } from './peopledatalabs.ts';
import { hunter } from './hunter.ts';
import { zerobounce } from './zerobounce.ts';
import { leadmagic } from './leadmagic.ts';
import { prospeo } from './prospeo.ts';
import { findymail } from './findymail.ts';
import { serper } from './serper.ts';
import { theirstack } from './theirstack.ts';
import { predictleads } from './predictleads.ts';
import { lusha } from './lusha.ts';
import { kaspr } from './kaspr.ts';
import { hubspot } from './hubspot.ts';

export const registry: Record<string, Adapter> = {
  mock, apollo, fullenrich, millionverifier, peopledatalabs, crustdata, exa, parallel,
  hunter, zerobounce, leadmagic, prospeo, findymail, serper, theirstack, predictleads, lusha, kaspr, hubspot,
};

export function isConfigured(a: Adapter): boolean {
  return a.requiredEnv.every((k) => env(k) !== undefined);
}

export function providerTable(): Array<{ provider: string; configured: boolean; env: string; tools: string; pricing: string; verifiedOn: string }> {
  return Object.values(registry)
    .filter((a) => a.name !== 'mock')
    .map((a) => ({
      provider: a.name,
      configured: isConfigured(a),
      env: a.requiredEnv.join(','),
      tools: Object.keys(a.tools).join(', '),
      pricing: Object.entries(a.pricing.table).map(([t, p]) => `${t}: ${p.credits} cr ${p.basis}`).join('; '),
      verifiedOn: a.pricing.verifiedOn,
    }));
}
