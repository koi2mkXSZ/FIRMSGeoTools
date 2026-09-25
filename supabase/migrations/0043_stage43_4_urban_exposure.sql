create table if not exists public.urban_exposure_ghsl_cache (
  cache_key text primary key,
  query_latitude double precision not null,
  query_longitude double precision not null,
  profile_version text not null,
  ghsl jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.urban_exposure_ghsl_cache enable row level security;
revoke all on table public.urban_exposure_ghsl_cache from anon, authenticated;
comment on table public.urban_exposure_ghsl_cache is 'Stage 43.4 server-side GHSL probe cache for Urban Exposure Profile. Service-role only.';
create index if not exists urban_exposure_ghsl_cache_updated_at_idx on public.urban_exposure_ghsl_cache(updated_at);
