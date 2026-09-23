# Data dictionary (Supabase, EU region)

Migrations in `supabase/migrations/`. Scripts connect with the service-role pooler URL from `.env`; RLS is enabled on every table with no policies (deny-all for anon/authenticated).

| Table | Purpose | Key columns |
|---|---|---|
| `datasets` | one per input CSV (slug = basename) | `slug`, `play` |
| `dataset_rows` | one per person row, cells persisted per leg | `(dataset_id,row_key)`, `input`, `cells` (JSONB: `email_result__<leg>`, `email`, `domain_resolution`) |
| `tool_receipts` | cache + cost ledger, one per provider call/item | `provider, tool, input_hash`, `status hit|miss|error`, `pricing_basis`, `cost_credits`, `run_id` |
| `runs` | one per `gtm run` | `status`, `rows_in`, `rows_out`, `total_cost_credits`, `receipt` (frozen) |
| `companies` | golden record by apex domain | `domain`, `name`, `field_sources`, `raw` |
| `people` | golden record by `person_key` | `email`, `email_status`, `email_source`, `confidence`, `do_not_contact`, `field_sources`, `raw` |
| `signals`, `scores`, `crm_sync` | phase 2, empty | |

`row_key` / `person_key`: `li:<slug>` when a LinkedIn URL exists, else `em:<email>`, else `nm:<sha256(first|last|apex)[:24]>`. Never a row index.

Useful queries:

```sql
select count(*) from dataset_rows where dataset_id = '<id>' and cells->'email'->>'value' is null;   -- rows still missing
select provider, tool, count(*), sum(cost_credits) from tool_receipts where run_id = '<run>' group by 1,2;
select email, email_source, confidence from people where domain = 'chift.eu';
```

## RGPD notes

- Data: names, work emails, LinkedIn URLs, job titles of B2B contacts in the EU. Stored in a Supabase project in an EU region.
- Legal basis: legitimate interest for B2B prospecting. `field_sources` records where each value came from (needed for Art. 14 information duties).
- No personal emails, no phones requested (`reveal_personal_emails:false`, `enrich_fields:['contact.emails']`).
- `people.do_not_contact` must be honoured by every downstream sync; set it on any opt-out.
- Retention rule to define: e.g. purge `people` rows never synced to the CRM after 12 months.
