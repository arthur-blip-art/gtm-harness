/**
 * LinkedIn name gate. Straight port of Deepline's scripts/validate-linkedin-names.py
 * (52 fixtures in tests/fixtures/name_validation.json must pass identically).
 * Without this gate ~26% of search-engine LinkedIn lookups return the wrong person.
 */

const QUOTED_NICK_RE = /['"]([\p{L}\p{N}_]+)['"]/u;
const CLEAN_NAME_RE = /[^\p{L}\p{N}_\s'-]/gu;
const NORMALIZE_RE = /[^a-z\s-]/g;

const N: Record<string, string[]> = {
  mike: ['michael'], michael: ['mike'],
  bob: ['robert', 'rob'], robert: ['bob', 'rob'], rob: ['robert', 'bob'],
  bill: ['william', 'will'], william: ['bill', 'will'], will: ['william', 'bill'],
  liz: ['elizabeth', 'beth'], elizabeth: ['liz', 'beth'], beth: ['elizabeth', 'liz'],
  jim: ['james', 'jimmy'], james: ['jim', 'jimmy'], jimmy: ['james', 'jim'],
  joe: ['joseph'], joseph: ['joe'],
  dan: ['daniel', 'danny'], daniel: ['dan', 'danny'], danny: ['daniel', 'dan'],
  dave: ['david'], david: ['dave'],
  chris: ['christopher'], christopher: ['chris'],
  matt: ['matthew'], matthew: ['matt'],
  tom: ['thomas'], thomas: ['tom'],
  tony: ['anthony'], anthony: ['tony'],
  nick: ['nicholas', 'nico'], nicholas: ['nick', 'nico'],
  rick: ['richard'], richard: ['rick', 'dick'], dick: ['richard'],
  steve: ['steven', 'stephen'], steven: ['steve', 'stephen'], stephen: ['steve', 'steven'],
  andy: ['andrew', 'drew'], andrew: ['andy', 'drew'], drew: ['andrew', 'andy'],
  alex: ['alexander', 'oleksandr', 'aleksandr'], alexander: ['alex', 'oleksandr'], oleksandr: ['alex', 'alexander'],
  sam: ['samuel', 'samantha'], samuel: ['sam'], samantha: ['sam'],
  ben: ['benjamin', 'benny'], benjamin: ['ben', 'benny'],
  jon: ['jonathan', 'john'], jonathan: ['jon', 'john'], john: ['jon', 'jonathan'],
  ed: ['edward', 'ted'], edward: ['ed', 'ted'], ted: ['edward', 'theodore'], theodore: ['ted'],
  pat: ['patrick', 'patricia'], patrick: ['pat'], patricia: ['pat'],
  kate: ['katherine', 'katie', 'kathy'], katherine: ['kate', 'katie', 'kathy'],
  jen: ['jennifer', 'jenny'], jennifer: ['jen', 'jenny'],
  sara: ['sarah'], sarah: ['sara'],
  meg: ['megan'], megan: ['meg'],
  mandy: ['amanda'], amanda: ['mandy'],
  ron: ['ronald'], ronald: ['ron'],
  charlie: ['charles', 'chuck'], charles: ['charlie', 'chuck'],
  greg: ['gregory'], gregory: ['greg'],
  jeff: ['jeffrey'], jeffrey: ['jeff'],
  doug: ['douglas'], douglas: ['doug'],
  nate: ['nathan', 'nathaniel'], nathan: ['nate'], nathaniel: ['nate'],
  zach: ['zachary'], zachary: ['zach'],
  max: ['maxwell', 'maximilian'], maxwell: ['max'], maximilian: ['max'],
  kat: ['katherine', 'kate', 'kathy'],
};
export const NICKNAMES: Record<string, Set<string>> = Object.fromEntries(Object.entries(N).map(([k, v]) => [k, new Set(v)]));

const nicks = (s: string) => NICKNAMES[s] ?? new Set<string>();
const intersects = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

/** Strip accents, lowercase, remove non-alpha except hyphens. */
export function normalizeName(s: string): string {
  const stripped = s.normalize('NFD').replace(/\p{M}/gu, '');
  return stripped.toLowerCase().trim().replace(NORMALIZE_RE, '').trim();
}

export function firstNamesMatch(source: string, profile: string): [boolean, string] {
  const sf = normalizeName(source);
  const pf = normalizeName(profile);
  if (!sf || !pf) return [false, 'empty'];
  if (sf === pf) return [true, 'exact'];
  if (sf.length >= 3 && (sf.startsWith(pf) || pf.startsWith(sf))) return [true, 'prefix'];
  const sfv = new Set([sf, ...nicks(sf)]);
  const pfv = new Set([pf, ...nicks(pf)]);
  if (intersects(sfv, pfv)) return [true, 'nickname'];
  if (sf.length === 1 && pf.startsWith(sf)) return [true, 'initial'];
  if (pf.length === 1 && sf.startsWith(pf)) return [true, 'initial'];
  const parts = sf.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      if (part === pf || (part.length >= 3 && (part.startsWith(pf) || pf.startsWith(part)))) return [true, 'multi_part'];
      if (intersects(new Set([part, ...nicks(part)]), pfv)) return [true, 'multi_part_nickname'];
    }
  }
  const m = QUOTED_NICK_RE.exec(profile.toLowerCase());
  if (m) {
    const nick = m[1];
    if (nick === sf || nicks(nick).has(sf) || nicks(sf).has(nick)) return [true, 'quoted_nickname'];
  }
  return [false, 'mismatch'];
}

export function lastNamesMatch(source: string, profile: string): [boolean, string] {
  const sl = normalizeName(source);
  const pl = normalizeName(profile);
  if (!sl || !pl) return [false, 'empty'];
  if (sl === pl) return [true, 'exact'];
  const slParts = new Set(sl.replace(/-/g, ' ').split(/\s+/).filter(Boolean));
  const plParts = new Set(pl.replace(/-/g, ' ').split(/\s+/).filter(Boolean));
  if (intersects(slParts, plParts)) return [true, 'hyphenated'];
  if (sl.includes(pl) || pl.includes(sl)) return [true, 'substring'];
  return [false, 'mismatch'];
}

export interface NameValidation {
  ok: boolean;
  reason?: string;
  firstMatch?: boolean;
  firstReason?: string;
  lastMatch?: boolean;
  lastReason?: string;
  profileFirst?: string;
  profileLast?: string;
}

export function validateName(sourceFirst: string, sourceLast: string, profileFullName: string): NameValidation {
  const profileClean = profileFullName.replace(CLEAN_NAME_RE, '').trim();
  const parts = profileClean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: 'profile_name_too_short' };
  const profileFirst = parts[0];
  const profileLast = parts.slice(1).join(' ');

  let [firstOk, firstReason] = firstNamesMatch(sourceFirst, profileFirst);
  if (!firstOk) {
    const m = QUOTED_NICK_RE.exec(profileClean.toLowerCase());
    if (m) {
      const nick = normalizeName(m[1]);
      const sf = normalizeName(sourceFirst);
      if (nick === sf || nicks(nick).has(sf) || nicks(sf).has(nick)) [firstOk, firstReason] = [true, 'quoted_nickname'];
    }
  }
  const [lastOk, lastReason] = lastNamesMatch(sourceLast, profileLast);
  const ok = firstOk && lastOk;
  return {
    ok, reason: ok ? undefined : `name_mismatch:${firstOk ? '' : 'first'}${firstOk || lastOk ? '' : '+'}${lastOk ? '' : 'last'}`,
    firstMatch: firstOk, firstReason, lastMatch: lastOk, lastReason, profileFirst, profileLast,
  };
}
