-- gtm-engine core: runs, receipts (cache + cost ledger), datasets, rows.
create extension if not exists pgcrypto;

create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  play text not null,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  play text not null,
  dataset_id uuid references datasets(id),
  status text not null check (status in ('running','done','failed','aborted')),
  input_summary jsonb not null default '{}',
  rows_in int not null default 0,
  rows_out int not null default 0,
  total_cost_credits numeric(12,4) not null default 0,
  total_cost_usd numeric(12,4) not null default 0,
  receipt jsonb,
  notes text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One row per provider call (or per batch item). Cache lookups read the latest hit|miss; errors are kept but never served.
create table if not exists tool_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  tool text not null,
  input_hash text not null,
  input jsonb not null,
  output jsonb,
  status text not null check (status in ('hit','miss','error')),
  pricing_basis text not null check (pricing_basis in ('per_call','per_hit','per_result','free','unknown')),
  cost_credits numeric(12,4) not null default 0,
  cost_usd numeric(12,4),
  http_status int,
  duration_ms int,
  error text,
  run_id uuid references runs(id),
  created_at timestamptz not null default now()
);
create index if not exists tool_receipts_lookup on tool_receipts (provider, tool, input_hash, created_at desc);
create index if not exists tool_receipts_run on tool_receipts (run_id);

create table if not exists dataset_rows (
  dataset_id uuid not null references datasets(id),
  row_key text not null,
  input jsonb not null,
  cells jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (dataset_id, row_key)
);
create index if not exists dataset_rows_missing_email on dataset_rows (dataset_id) where (cells->'email'->>'value') is null;

alter table datasets enable row level security;
alter table runs enable row level security;
alter table tool_receipts enable row level security;
alter table dataset_rows enable row level security;
