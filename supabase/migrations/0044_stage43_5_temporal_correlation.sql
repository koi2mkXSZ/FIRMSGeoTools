-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 44
-- Stage 43.5 — Temporal Correlation Engine
-- 2026-09-25

alter table public.fire_events
  add column if not exists temporal_correlation_updated_at timestamptz;

comment on column public.fire_events.temporal_correlation_updated_at is
  'Last material change of the normalized Stage 43.5 temporal correlation profile.';

create table if not exists public.event_temporal_correlations (
  fire_event_id uuid primary key references public.fire_events(id) on delete cascade,
  profile_version text not null default 'temporal-correlation-v1',
  reference_time timestamptz not null,
  reference_source text not null default 'FIRMS first_seen',
  consistency_score smallint,
  consistency_level text not null default 'unknown',
  alignment_score smallint,
  coverage_score smallint,
  source_count smallint not null default 0,
  family_count smallint not null default 0,
  timeline jsonb not null default '[]'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  explanations jsonb not null default '[]'::jsonb,
  profile_hash text not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_temporal_correlations enable row level security;
revoke all on table public.event_temporal_correlations from anon,authenticated;
grant select,insert,update,delete on table public.event_temporal_correlations to service_role;

create index if not exists event_temporal_correlations_updated_at_idx
  on public.event_temporal_correlations(updated_at desc);

create index if not exists event_temporal_correlations_level_idx
  on public.event_temporal_correlations(consistency_level,updated_at desc);

do $$
begin
  if exists(select 1 from cron.job where jobname='firewatch-temporal-correlation') then
    perform cron.unschedule('firewatch-temporal-correlation');
  end if;
end $$;

select cron.schedule(
  'firewatch-temporal-correlation',
  '6,21,36,51 * * * *',
  $cron$
  select net.http_post(
    url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-temporal-correlation',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
    ),
    body := '{"hours":168,"limit":250}'::jsonb,
    timeout_milliseconds := 90000
  );
  $cron$
);
