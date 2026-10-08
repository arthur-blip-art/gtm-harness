import { apexDomain } from './normalize.ts';

/**
 * What a homepage says about where to look next. The pages a seller reads before writing
 * (pricing, customers, integrations, careers, team, security, changelog, blog) and the ATS board
 * behind the careers page, all from the links, so no guessing of URLs and no paid call.
 */
export type PageKind = 'pricing' | 'customers' | 'integrations' | 'careers' | 'team' | 'security' | 'changelog' | 'blog' | 'contact' | 'partners';

const PATTERNS: Array<[PageKind, RegExp, RegExp]> = [
  ['pricing', /\/(pricing|prix|tarifs?|plans)(\/|$)/i, /pricing|tarif|prix|plans/i],
  ['customers', /\/(customers?|clients?|case-stud(y|ies)|success-stor|temoignages|references)(\/|$)/i, /customers|clients|case stud|success stor|témoignages|références/i],
  ['integrations', /\/(integrations?|connect(ors|eurs)?|apps|marketplace|ecosystem)(\/|$)/i, /integrations?|intégrations?|connecteurs|marketplace|app ?store/i],
  ['careers', /\/(careers?|jobs|join(-us)?|recrutement|carrieres?|work-with-us|hiring)(\/|$)/i, /careers|jobs|join us|we.re hiring|recrut|carrières|rejoignez/i],
  ['team', /\/(about(-us)?|team|equipe|qui-sommes-nous|company|a-propos|leadership)(\/|$)/i, /about|team|équipe|qui sommes|à propos|leadership/i],
  ['security', /\/(security|trust|securite|compliance|gdpr|rgpd)(\/|$)/i, /security|trust center|sécurité|compliance/i],
  ['changelog', /\/(changelog|release-notes|whats-new|updates|nouveautes)(\/|$)/i, /changelog|release notes|what.s new|nouveautés/i],
  ['blog', /\/(blog|news|actualites|press|newsroom|ressources)(\/|$)/i, /^blog$|newsroom|press|actualités/i],
  ['contact', /\/(contact(-us)?|demo|book-a-demo|request-demo)(\/|$)/i, /contact|book a demo|demander une démo/i],
  ['partners', /\/(partners?|partenaires?)(\/|$)/i, /partners?|partenaires?/i],
];

export function keyPages(links: Array<{ href: string; text: string }>, homeUrl: string): Partial<Record<PageKind, string>> {
  const home = apexDomain(homeUrl);
  const out: Partial<Record<PageKind, string>> = {};
  for (const l of links) {
    let u: URL;
    try { u = new URL(l.href); } catch { continue; }
    const sameSite = apexDomain(u.hostname) === home;
    for (const [kind, path, text] of PATTERNS) {
      if (out[kind]) continue;
      // Careers often live on the ATS host: keep the link even off-site.
      if ((sameSite && (path.test(u.pathname) || text.test(l.text))) || (kind === 'careers' && atsBoard(l.href))) out[kind] = `${u.origin}${u.pathname}`;
    }
  }
  return out;
}

export interface AtsBoard { ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'recruitee'; board: string; tool: string }

const ATS: Array<[AtsBoard['ats'], RegExp, string]> = [
  ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/i, 'greenhouse_jobs'],
  ['lever', /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i, 'lever_jobs'],
  ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, 'ashby_jobs'],
  ['workable', /apply\.workable\.com\/([a-z0-9_-]+)/i, 'workable_jobs'],
  ['recruitee', /([a-z0-9-]+)\.recruitee\.com/i, 'recruitee_jobs'],
];

export function atsBoard(s: string): AtsBoard | null {
  for (const [ats, re, tool] of ATS) {
    const m = re.exec(s);
    if (m && m[1] && !['embed', 'api', 'www'].includes(m[1].toLowerCase())) return { ats, board: m[1].toLowerCase(), tool };
  }
  return null;
}

/** Boards named anywhere in a page (links, scripts, iframes rendered as links). First one wins. */
export function findAts(pages: Array<{ links?: Array<{ href: string }>; scripts?: string[]; markers?: string[] }>): AtsBoard | null {
  for (const p of pages) for (const s of [...(p.links ?? []).map((l) => l.href), ...(p.scripts ?? []), ...(p.markers ?? [])]) {
    const b = atsBoard(s);
    if (b) return b;
  }
  return null;
}

/** Social profiles linked from the site: the LinkedIn company page and the X handle. */
export function socialLinks(links: Array<{ href: string }>): { linkedin?: string; x?: string; github?: string } {
  const out: { linkedin?: string; x?: string; github?: string } = {};
  for (const { href } of links) {
    if (!out.linkedin) { const m = /linkedin\.com\/company\/([^/?#]+)/i.exec(href); if (m) out.linkedin = `https://www.linkedin.com/company/${m[1].toLowerCase()}`; }
    if (!out.x) { const m = /(?:twitter|x)\.com\/(?!intent|share|home)([a-z0-9_]{2,15})(?:[/?#]|$)/i.exec(href); if (m) out.x = m[1]; }
    if (!out.github) { const m = /github\.com\/([a-z0-9-]+)(?:[/?#]|$)/i.exec(href); if (m) out.github = m[1]; }
  }
  return out;
}
