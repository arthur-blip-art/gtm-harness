-- Golden records. Written by precedence (first source in leg order wins); every field names its source.
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  domain text unique not null,
  name text,
  linkedin_url text,
  country text,
  industry text,
  headcount int,
  field_sources jsonb not null default '{}',
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  person_key text unique not null,
  first_name text,
  last_name text,
  title text,
  company_id uuid references companies(id),
  domain text,
  linkedin_url text,
  email text,
  email_status text,
  email_source text,
  email_verified_at timestamptz,
  confidence text check (confidence in ('HIGH','MEDIUM','LOW','HOLD')),
  field_sources jsonb not null default '{}',
  raw jsonb not null default '{}',
  do_not_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists people_email on people (email);
create index if not exists people_company on people (company_id);
create index if not exists people_domain on people (domain);

alter table companies enable row level security;
alter table people enable row level security;
