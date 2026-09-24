import type { Play } from '../core/play.ts';
import * as nameDomainToEmail from './name-domain-to-email.ts';
import * as personLinkedinToEmail from './person-linkedin-to-email.ts';
import * as personToLinkedin from './person-to-linkedin.ts';
import * as personToPhone from './person-to-phone.ts';
import * as companyEnrich from './company-enrich.ts';
import * as icpToCompanies from './icp-to-companies.ts';
import * as companyToPeople from './company-to-people.ts';
import * as companySignals from './company-signals.ts';
import * as scoreAccounts from './score-accounts.ts';
import * as syncHubspot from './sync-hubspot.ts';
import * as icpToPipeline from './icp-to-pipeline.ts';

const all: Play[] = [
  nameDomainToEmail.scalar, nameDomainToEmail.batch,
  personLinkedinToEmail.scalar, personLinkedinToEmail.batch,
  personToLinkedin.scalar, personToLinkedin.batch,
  personToPhone.scalar, personToPhone.batch,
  companyEnrich.scalar, companyEnrich.batch,
  icpToCompanies.play, companyToPeople.play,
  companySignals.play, companySignals.batch,
  scoreAccounts.play, syncHubspot.play, icpToPipeline.play,
];

export const plays: Record<string, Play> = Object.fromEntries(all.map((p) => [p.name, p]));

export function resolvePlay(name: string): Play {
  const p = plays[name];
  if (!p) throw new Error(`Unknown play ${name}. Known: ${Object.keys(plays).join(', ')}`);
  return p;
}
