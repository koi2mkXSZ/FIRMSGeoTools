-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 46
-- Stage 43.5.1 — Neptun Historical Backfill
-- 2026-09-25

create table if not exists public.neptun_source_messages (
  source_handle text not null,
  message_id bigint not null,
  source_title text,
  source_kind text,
  source_region text,
  published_at timestamptz not null,
  message_text text not null default '',
  message_url text,
  classification text not null default 'other',
  reconstruction_mode text not null default 'telegram_public_archive',
  collected_at timestamptz not null default now(),
  raw_hash text not null,
  primary key(source_handle,message_id)
);

alter table public.neptun_source_messages enable row level security;
revoke all on table public.neptun_source_messages from anon,authenticated;
grant select,insert,update,delete on table public.neptun_source_messages to service_role;

create index if not exists neptun_source_messages_time_idx
  on public.neptun_source_messages(published_at desc);
create index if not exists neptun_source_messages_class_time_idx
  on public.neptun_source_messages(classification,published_at desc);
create index if not exists neptun_source_messages_region_time_idx
  on public.neptun_source_messages(source_region,published_at desc);

create table if not exists public.neptun_backfill_sources (
  source_handle text primary key,
  source_title text,
  source_kind text,
  source_region text,
  backfill_before_id bigint,
  newest_message_id bigint,
  oldest_message_id bigint,
  newest_published_at timestamptz,
  oldest_published_at timestamptz,
  reached_cutoff boolean not null default false,
  pages_scanned integer not null default 0,
  messages_seen bigint not null default 0,
  messages_inserted bigint not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.neptun_backfill_sources enable row level security;
revoke all on table public.neptun_backfill_sources from anon,authenticated;
grant select,insert,update,delete on table public.neptun_backfill_sources to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='firewatch-neptun-backfill') then
    perform cron.unschedule('firewatch-neptun-backfill');
  end if;
end $$;

select cron.schedule(
  'firewatch-neptun-backfill',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-neptun-backfill',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
    ),
    body := '{"days":7,"source_limit":8,"pages_per_source":2}'::jsonb,
    timeout_milliseconds := 90000
  );
  $cron$
);
