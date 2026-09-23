-- Phase 2 tables, created empty so later work is additive.
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  person_id uuid references people(id),
  type text not null,
  value jsonb not null default '{}',
  source text not null,
  observed_at timestamptz,
  receipt_id uuid references tool_receipts(id),
  created_at timestamptz not null default now()
);
create index if not exists signals_company on signals (company_id, type, observed_at desc);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  person_id uuid references people(id),
  model text not null,
  dimension text not null check (dimension in ('account_fit','account_engagement','lead_fit','lead_engagement')),
  score numeric,
  tier text,
  reasons jsonb not null default '[]',
  computed_at timestamptz not null default now()
);

create table if not exists crm_sync (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('company','person')),
  entity_id uuid not null,
  crm text not null default 'hubspot',
  crm_object_type text,
  crm_id text,
  last_hash text,
  last_synced_at timestamptz,
  status text,
  error text,
  unique (entity_type, entity_id, crm)
);

alter table signals enable row level security;
alter table scores enable row level security;
alter table crm_sync enable row level security;
