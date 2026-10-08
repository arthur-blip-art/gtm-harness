/**
 * Free tech-stack detection, the first layers of a tech-stack teardown (GooseWorks method):
 *   1. DNS: MX says the mail suite, SPF includes and TXT verifications name every tool allowed to
 *      send mail or verified on the domain (HubSpot, Salesforce, SendGrid, Outreach…). They do not lie.
 *   2. Website source: script hosts and inline markers (pixels, chat, analytics, ABM, payments).
 *   3. Job ads: the tools a team says it works with ("experience with Salesforce, dbt, Snowflake").
 * Every detection keeps its evidence and its layer, so a sales rep can quote it.
 * Paid fallback when this is thin: TheirStack technographics (job-ad based, at scale).
 */
export interface Tech { name: string; category: string; evidence: string; layer: 'dns' | 'website' | 'jobs' }

type Rule = { name: string; category: string; dns?: RegExp; web?: RegExp; jobs?: RegExp };

const RULES: Rule[] = [
  // CRM & marketing automation
  { name: 'HubSpot', category: 'crm', dns: /hubspot|hs-?email|hubspotemail/i, web: /hs-scripts|js\.hs-|hubspot|hsforms|hs-analytics/i, jobs: /\bhubspot\b/i },
  { name: 'Salesforce', category: 'crm', dns: /salesforce|_spf\.salesforce|exacttarget/i, web: /salesforce|force\.com|pardot/i, jobs: /\bsalesforce\b|\bsfdc\b/i },
  { name: 'Pipedrive', category: 'crm', web: /pipedrive/i, jobs: /\bpipedrive\b/i },
  { name: 'Marketo', category: 'marketing_automation', dns: /mktomail|marketo/i, web: /marketo|mktoforms|munchkin/i, jobs: /\bmarketo\b/i },
  { name: 'Pardot', category: 'marketing_automation', web: /pardot|pi\.pardot/i, jobs: /\bpardot\b|account engagement/i },
  { name: 'Brevo', category: 'email_marketing', dns: /sendinblue|brevo/i, web: /sendinblue|brevo/i, jobs: /\bbrevo\b|sendinblue/i },
  { name: 'Mailchimp', category: 'email_marketing', dns: /mailchimp|mcsv\.net|mandrillapp/i, web: /mailchimp|list-manage/i },
  { name: 'Customer.io', category: 'email_marketing', dns: /customer\.io|customeriomail/i, web: /customer\.io|customerioforms/i },
  { name: 'Klaviyo', category: 'email_marketing', dns: /klaviyo/i, web: /klaviyo/i },
  // Sales engagement (who already runs outbound)
  { name: 'Outreach', category: 'sales_engagement', dns: /outreach\.io|mktdns/i, jobs: /\boutreach\.io\b|\boutreach\b(?= ?\(|,| or)/i },
  { name: 'Salesloft', category: 'sales_engagement', dns: /salesloft/i, jobs: /\bsalesloft\b/i },
  { name: 'Lemlist', category: 'sales_engagement', dns: /lemlist/i, web: /lemlist/i, jobs: /\blemlist\b/i },
  { name: 'Apollo', category: 'sales_engagement', web: /assets\.apollo\.io|apollo\.io\/js/i, jobs: /\bapollo(\.io)?\b/i },
  { name: 'Gong', category: 'revenue_intelligence', web: /gong\.io/i, jobs: /\bgong\b/i },
  // ABM / intent / visitor identification
  { name: '6sense', category: 'abm_intent', web: /6sense|j\.6sc\.co/i, jobs: /\b6sense\b/i },
  { name: 'Clearbit', category: 'abm_intent', web: /clearbit|tag\.clearbitscripts/i },
  { name: 'ZoomInfo', category: 'abm_intent', web: /zoominfo|ws\.zoominfo/i, jobs: /\bzoominfo\b/i },
  { name: 'RB2B', category: 'abm_intent', web: /rb2b|reb2b/i },
  { name: 'Warmly', category: 'abm_intent', web: /warmly/i },
  { name: 'Koala', category: 'abm_intent', web: /getkoala|koala\.live/i },
  // Email delivery
  { name: 'Google Workspace', category: 'email_suite', dns: /google\.com|googlemail|_spf\.google/i },
  { name: 'Microsoft 365', category: 'email_suite', dns: /outlook\.com|protection\.outlook|spf\.protection/i },
  { name: 'SendGrid', category: 'email_delivery', dns: /sendgrid/i },
  { name: 'Amazon SES', category: 'email_delivery', dns: /amazonses/i },
  { name: 'Postmark', category: 'email_delivery', dns: /mtasv\.net|postmark/i },
  { name: 'Mailgun', category: 'email_delivery', dns: /mailgun/i },
  // Support & chat
  { name: 'Intercom', category: 'support_chat', web: /intercom|widget\.intercom\.io/i, jobs: /\bintercom\b/i },
  { name: 'Zendesk', category: 'support_chat', dns: /zendesk/i, web: /zendesk|zdassets/i, jobs: /\bzendesk\b/i },
  { name: 'Drift', category: 'support_chat', web: /drift\.com|js\.driftt/i },
  { name: 'Crisp', category: 'support_chat', web: /crisp\.chat/i },
  { name: 'Freshdesk', category: 'support_chat', dns: /freshdesk/i, web: /freshdesk|freshworks|freshchat/i },
  // Analytics & product
  { name: 'Google Analytics', category: 'analytics', web: /gtag|google-analytics|googletagmanager/i },
  { name: 'Segment', category: 'cdp', web: /segment\.com|cdn\.segment|analytics\.js/i, jobs: /\bsegment\b(?! of)/i },
  { name: 'Mixpanel', category: 'product_analytics', web: /mixpanel/i, jobs: /\bmixpanel\b/i },
  { name: 'Amplitude', category: 'product_analytics', web: /amplitude/i, jobs: /\bamplitude\b/i },
  { name: 'PostHog', category: 'product_analytics', web: /posthog/i, jobs: /\bposthog\b/i },
  { name: 'Heap', category: 'product_analytics', web: /heapanalytics|heap-/i },
  { name: 'Hotjar', category: 'analytics', web: /hotjar/i },
  { name: 'Pendo', category: 'product_adoption', web: /pendo/i, jobs: /\bpendo\b/i },
  { name: 'Appcues', category: 'product_adoption', web: /appcues/i },
  // Ads
  { name: 'LinkedIn Insight Tag', category: 'ads', web: /_linkedin_partner_id|snap\.licdn\.com/i },
  { name: 'Meta Pixel', category: 'ads', web: /fbq|connect\.facebook\.net/i },
  // Payments & billing
  { name: 'Stripe', category: 'billing', dns: /stripe/i, web: /js\.stripe\.com|stripe/i, jobs: /\bstripe\b/i },
  { name: 'Chargebee', category: 'billing', web: /chargebee/i, jobs: /\bchargebee\b/i },
  { name: 'Paddle', category: 'billing', web: /paddle\.com|cdn\.paddle/i },
  // Demo & scheduling
  { name: 'Calendly', category: 'scheduling', web: /calendly/i },
  { name: 'Chili Piper', category: 'scheduling', web: /chilipiper/i },
  { name: 'Navattic', category: 'interactive_demo', web: /navattic/i },
  { name: 'Storylane', category: 'interactive_demo', web: /storylane/i },
  // Website
  { name: 'Webflow', category: 'website', web: /webflow/i },
  { name: 'Framer', category: 'website', web: /framer(usercontent)?\.com|framer/i },
  { name: 'WordPress', category: 'website', web: /wp-content|wordpress/i },
  { name: 'Next.js', category: 'website', web: /__next|_next\/static/i },
  // Data & engineering (from job ads mostly)
  { name: 'Snowflake', category: 'data', jobs: /\bsnowflake\b/i },
  { name: 'BigQuery', category: 'data', jobs: /\bbigquery\b/i },
  { name: 'dbt', category: 'data', jobs: /\bdbt\b/i },
  { name: 'AWS', category: 'cloud', jobs: /\baws\b|amazon web services/i },
  { name: 'GCP', category: 'cloud', jobs: /\bgcp\b|google cloud/i },
  { name: 'Azure', category: 'cloud', jobs: /\bazure\b/i },
  { name: 'Kubernetes', category: 'cloud', jobs: /\bkubernetes\b|\bk8s\b/i },
  { name: 'Sentry', category: 'engineering', web: /sentry/i, jobs: /\bsentry\b/i },
  { name: 'Datadog', category: 'engineering', web: /datadog/i, jobs: /\bdatadog\b/i },
  { name: 'LaunchDarkly', category: 'engineering', web: /launchdarkly/i },
  // Consent
  { name: 'OneTrust', category: 'consent', web: /onetrust|cookielaw/i },
  { name: 'Axeptio', category: 'consent', web: /axeptio/i },
  { name: 'Didomi', category: 'consent', web: /didomi/i },
];

export interface FingerprintInput {
  dns?: { mx?: string[]; txt?: string[]; dmarc?: string[] } | null;
  pages?: Array<{ url: string; scripts?: string[]; markers?: string[]; generator?: string | null }>;
  jobs?: Array<{ title: string; text?: string; url?: string | null }>;
}

export function fingerprint(input: FingerprintInput): Tech[] {
  const found = new Map<string, Tech>();
  const add = (r: Rule, layer: Tech['layer'], evidence: string) => {
    if (!found.has(r.name)) found.set(r.name, { name: r.name, category: r.category, layer, evidence: evidence.slice(0, 160) });
  };
  const dnsLines = [...(input.dns?.mx ?? []).map((m) => `MX ${m}`), ...(input.dns?.txt ?? []).map((t) => `TXT ${t}`)];
  for (const r of RULES) {
    if (r.dns) { const hit = dnsLines.find((l) => r.dns!.test(l)); if (hit) { add(r, 'dns', hit); continue; } }
    if (r.web) {
      for (const p of input.pages ?? []) {
        const hit = [...(p.scripts ?? []), ...(p.markers ?? []), p.generator ?? ''].find((s) => s && r.web!.test(s));
        if (hit) { add(r, 'website', `${hit} on ${p.url}`); break; }
      }
      if (found.has(r.name)) continue;
    }
    if (r.jobs) {
      const hit = (input.jobs ?? []).find((j) => r.jobs!.test(`${j.title} ${j.text ?? ''}`));
      if (hit) add(r, 'jobs', `job ad "${hit.title}"${hit.url ? ` ${hit.url}` : ''}`);
    }
  }
  return [...found.values()];
}

/** DMARC policy and whether the domain sends from a separate outbound domain is left to the reader; this says what the policy is. */
export function dmarcPolicy(dmarc: string[] | undefined): string | null {
  const rec = (dmarc ?? []).find((t) => /v=DMARC1/i.test(t));
  return rec ? (/p=(\w+)/i.exec(rec)?.[1]?.toLowerCase() ?? 'set') : null;
}
