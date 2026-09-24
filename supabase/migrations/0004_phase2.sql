-- Phase 2: phone + linkedin on people, richer companies, usable signals/scores/crm_sync.
alter table people
  add column if not exists phone text,
  add column if not exists phone_status text,
  add column if not exists phone_source text,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists linkedin_source text,
  add column if not exists linkedin_confidence text;

alter table companies
  add column if not exists city text,
  add column if not exists employees_range text,
  add column if not exists founded_year int,
  add column if not exists funding_total_usd numeric(16,2),
  add column if not exists funding_last_round text,
  add column if not exists funding_last_date date,
  add column if not exists tech jsonb not null default '[]';

alter table signals
  add column if not exists domain text,
  add column if not exists dedupe_key text;
create unique index if not exists signals_dedupe on signals (dedupe_key);
create index if not exists signals_domain on signals (domain, type, observed_at desc);

alter table scores
  add column if not exists domain text,
  add column if not exists inputs jsonb not null default '{}',
  add column if not exists miss_reason text;
create unique index if not exists scores_unique on scores (domain, model, dimension);

-- crm_sync keys on our stable text identities (person_key / domain), not uuids.
alter table crm_sync drop constraint if exists crm_sync_entity_type_entity_id_crm_key;
alter table crm_sync alter column entity_id type text using entity_id::text;
create unique index if not exists crm_sync_unique on crm_sync (entity_type, entity_id, crm);
create index if not exists crm_sync_crm_id on crm_sync (crm, crm_id);
