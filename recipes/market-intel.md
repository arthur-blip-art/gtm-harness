# Recipe: understand an account, its stack, and what people say

Use when the user wants context before acting: "prépare-moi un brief sur acme.io avant mon appel", "quelle stack
utilise X", "qui parle de notre concurrent", "what are people saying about Clay", "veille sur ces sujets".

| ask | play | cost |
|---|---|---|
| a one-page brief before a call or an email | `account-context --input '{"domain":"acme.io","offer":"…","out_dir":"gtm-data/briefs"}'` | free reads + one LLM call; Maps phone ~$0.003 |
| the sales, marketing and product stack | `tech-stack` (or `tech-stack:batch --csv domains.csv --out stack.csv`) | free: DNS, website source, job ads |
| situation and timing of a list of accounts | `company-signals:batch --csv domains.csv --out signals.csv` (`paid` column: never / gap / always) | free first, paid only for gaps |
| mentions of a brand, a competitor or a problem | `social-listening --input @config/social-listening.json` | HN + Google News free, LinkedIn/Reddit/X ~$0.002 per item or call, Exa ~$0.005 |
| buying signals on LinkedIn, champion job changes | `linkedin-signals` (see `recipes/linkedin-signals.md`; `champions[]` for job changes) | HarvestAPI per item |

## How to read the outputs

- **Every fact carries its source URL and date.** The brief's angles are dropped if the LLM cites a URL that was not
  read. Quote the source, not the model.
- **The stack says where it was seen**: `dns` (SPF, MX, TXT verifications: hard evidence), `website` (a script or a
  pixel on a named page), `jobs` (named in a job ad: the team uses it or is about to). Say which.
- **Signals have a shelf life** (`core/signal-rules.ts`): funding 180 days, new executive 90, launch 60, job ad 45,
  mention 30. Older, it stays out of the first line.
- **Intent** in social listening is a phrase match ("alternative to", "looking for", "on cherche"): a reason to read the
  thread, not a lead by itself.

## Limits to state

- Single-page apps hide their text from a plain fetch: the brief says "Rendered homepage" when ScrapeGraph was used,
  and says the site was unreachable when nothing could be read.
- The free news filter drops namesakes but can still keep a homonym with an exact name: read the headline before using
  it in a first line.
- ATS coverage: Greenhouse, Lever, Ashby, Workable, Recruitee. Other boards fall back to the paid job APIs.
