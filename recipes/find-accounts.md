# Recipe: the accounts most worth writing to for Chift

Use when the user asks for a list of companies relevant to Chift ("give me 10 companies relevant for Chift",
"trouve-moi 10 entreprises pertinentes pour Chift"). Free: no provider credit is spent. Then hand any account to
`recipes/account-to-sequence.md`.

## Where the accounts come from

The coverage benchmark (`../chift-benchmark`, live at https://connectivity-benchmark-ag.vercel.app) holds 159 B2B
software vendors in 9 categories, collected where vendors declare their accounting integrations themselves:
connect-compta (Chift's directory), the partner marketplaces of the ledgers (DATEV, Exact, Pennylane…), and each
vendor's own integrations page. So every vendor already ships integrations: Chift's best-converting signal holds by
construction. Each connection links to its public source.

## Steps

1. **What we already know**, read-only: `node scripts/hubspot-domains.mjs --out gtm-data/known-hubspot.txt`
   (companies already in HubSpot). Add any list already worked (for the Chift test:
   `gtm-data/chift-test/chift-outbound-30.csv`, column `domain`) to the same file.
2. **Rank**: `cd ../chift-benchmark && npx tsx collector/top-accounts.ts --top 10 --exclude ../gtm-harness/gtm-data/known-hubspot.txt`
   (add `--category expense` to stay in one vertical). It removes Chift customers and competitors, the known domains,
   vendors whose pages could not be read (their gap may only be ours) and vendors known to be over 500 people, then
   ranks one line per vendor by its strongest gap: a dominant or important ledger reached by at least 2 out of 3
   competitors active in the same country, and not by this vendor.
3. **Check the shortlist** before showing it as final, with a web search per account, sources kept:
   - headcount where the table says "to check": drop above 500 (the brief's ICP is 50 to 500);
   - for a country marked "inferred", a local site or local customers; otherwise say the country is a guess;
   - not acquired, not shut down.
4. **Show** the table, then one line on what was removed and why (the script prints the counts), then the proof link of
   each account (the benchmark, prefilled on its domain and country).

## How to explain the ranking

- Signal 1, already integrates: true for every vendor in the dataset, read on its own pages.
- Signal 2, the gap: what most of its competitors reach and it does not, in one country. It is the rank.
- Signal 3, the timing (funding, new executive, job ad, new country): searched next, per account, in
  `account-to-sequence.md` step 4. It does not change the rank; it decides when to write.
