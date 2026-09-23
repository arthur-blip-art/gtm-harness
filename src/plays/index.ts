import * as nameDomainToEmail from './name-domain-to-email.ts';

export const plays = {
  [nameDomainToEmail.NAME]: nameDomainToEmail,
};
export type PlayName = keyof typeof plays;
