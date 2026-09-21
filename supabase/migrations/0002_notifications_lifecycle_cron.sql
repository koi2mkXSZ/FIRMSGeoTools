-- FIRMSGeoTools Community Edition
-- Clean Core schema v0.2: bootstrap-safe notifications, lifecycle, Telegram lease, cron installer.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

alter table public.project_config
  add column if not exists inactive_after_hours integer not null default 3 check(inactive_after_hours between 1 and 72),
  add column if not exists close_after_hours integer not null default 24 check(close_after_hours between 2 and 720);

alter table public.fire_events
  add column if not exists telegram_last_observation_count integer,
  add column if not exists telegram_last_seen_snapshot timestamptz,
  add column if not exists telegram_last_update_at timestamptz;

alter table public.fire_events drop constraint if exists fire_events_lifecycle_status_check;
alter table public.fire_events
  add constraint fire_events_lifecycle_status_check
  check(lifecycle_status in ('new','confirmed','active','inactive','closed'));

create index if not exists fire_events_pending_notification_idx
on public.fire_events(notification_required,telegram_sent,first_seen)
where notification_required=true and telegram_sent=false;

create table if not exists public.telegram_delivery_lease(
  id boolean primary key default true check(id=true),
  holder text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.telegram_delivery_lease(id,holder,expires_at)
values(true,null,null) on conflict(id) do nothing;

alter table public.telegram_delivery_lease enable row level security;
revoke all on table public.telegram_delivery_lease from public,anon,authenticated;
grant select,update on table public.telegram_delivery_lease to service_role;

do $$
declare v_secret text;
begin
  if not exists(select 1 from vault.secrets where name='firewatch_cron_secret') then
    v_secret:=encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'firewatch_cron_secret','FIRMSGeoTools pg_cron authentication',null);
  end if;
end $$;

create or replace function public.firewatch_acquire_telegram_lease(
  p_holder text,p_ttl_seconds integer default 120
)
returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_count integer:=0;
begin
  if nullif(trim(p_holder),'') is null then return false; end if;
  update public.telegram_delivery_lease
  set holder=p_holder,
      expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_ttl_seconds,120),300))),
      updated_at=now()
  where id=true and (expires_at is null or expires_at<now() or holder=p_holder);
  get diagnostics v_count=row_count;
  return v_count>0;
end $$;

create or replace function public.firewatch_release_telegram_lease(p_holder text)
returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_count integer:=0;
begin
  update public.telegram_delivery_lease
  set holder=null,expires_at=null,updated_at=now()
  where id=true and holder=p_holder;
  get diagnostics v_count=row_count;
  return v_count>0;
end $$;

create or replace function public.firewatch_complete_bootstrap(p_fresh_hours integer default null)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_hours integer;
  v_marked integer:=0;
begin
  select coalesce(p_fresh_hours,bootstrap_fresh_hours) into v_hours
  from public.project_config where id=true;

  update public.fire_events
  set notification_required=true,updated_at=now()
  where telegram_sent=false
    and first_seen>=now()-make_interval(hours=>greatest(0,least(v_hours,24)));
  get diagnostics v_marked=row_count;

  insert into public.system_state(key,value,updated_at)
  values('bootstrap',jsonb_build_object(
    'done',true,'completed_at',now(),'fresh_window_hours',v_hours,'fresh_events_marked',v_marked
  ),now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'fresh_window_hours',v_hours,'fresh_events_marked',v_marked);
end $$;

create or replace function public.set_fire_event_notification_required()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_bootstrap_done boolean:=false;
begin
  select coalesce((value->>'done')::boolean,false)
  into v_bootstrap_done from public.system_state where key='bootstrap';
  new.notification_required:=coalesce(v_bootstrap_done,false);
  return new;
end $$;

drop trigger if exists fire_events_set_notification_required on public.fire_events;
create trigger fire_events_set_notification_required
before insert on public.fire_events
for each row execute function public.set_fire_event_notification_required();

create or replace function public.firewatch_refresh_lifecycle()
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_inactive integer;
  v_close integer;
  v_closed integer:=0;
  v_inactivated integer:=0;
  v_reclassified integer:=0;
begin
  select inactive_after_hours,close_after_hours into v_inactive,v_close
  from public.project_config where id=true;

  update public.fire_events
  set status='closed',lifecycle_status='closed',updated_at=now()
  where status<>'closed' and last_seen<now()-make_interval(hours=>v_close);
  get diagnostics v_closed=row_count;

  update public.fire_events
  set status='inactive',lifecycle_status='inactive',updated_at=now()
  where status='active'
    and last_seen<now()-make_interval(hours=>v_inactive)
    and last_seen>=now()-make_interval(hours=>v_close);
  get diagnostics v_inactivated=row_count;

  update public.fire_events
  set lifecycle_status=case
      when observation_count>=3 or multisource_count>=2 then 'active'
      when observation_count>=2 then 'confirmed'
      else 'new'
    end,
    status='active',
    updated_at=now()
  where status='active' and lifecycle_status not in('closed','inactive');
  get diagnostics v_reclassified=row_count;

  return jsonb_build_object(
    'closed',v_closed,'inactivated',v_inactivated,'active_reclassified',v_reclassified,
    'inactive_after_hours',v_inactive,'close_after_hours',v_close
  );
end $$;

create or replace function public.firewatch_configure_core_cron(p_base_url text)
returns jsonb language plpgsql security definer
set search_path=public,cron,vault,pg_temp
as $$
declare
  j record;
  v_url text:=rtrim(p_base_url,'/');
  v_poll integer;
  v_firms_schedule text;
begin
  if v_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Invalid Supabase base URL';
  end if;

  select poll_interval_minutes into v_poll from public.project_config where id=true;
  v_poll:=greatest(5,least(coalesce(v_poll,15),60));
  v_firms_schedule:=case when v_poll=60 then '0 * * * *' else format('*/%s * * * *',v_poll) end;

  for j in select jobid from cron.job where jobname in(
    'firmsgeotools-firms','firmsgeotools-telegram','firmsgeotools-lifecycle'
  ) loop
    perform cron.unschedule(j.jobid);
  end loop;

  perform cron.schedule(
    'firmsgeotools-firms',v_firms_schedule,
    format($cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      );
    $cmd$,v_url||'/functions/v1/firewatch-firms')
  );

  perform cron.schedule(
    'firmsgeotools-telegram','1,11,16,26,31,41,46,56 * * * *',
    format($cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      );
    $cmd$,v_url||'/functions/v1/firewatch-telegram')
  );

  perform cron.schedule(
    'firmsgeotools-lifecycle','9,24,39,54 * * * *',
    $$select public.firewatch_refresh_lifecycle();$$
  );

  insert into public.system_state(key,value,updated_at)
  values('core_cron',jsonb_build_object(
    'configured',true,'configured_at',now(),'base_url',v_url,
    'firms',v_firms_schedule,
    'telegram','1,11,16,26,31,41,46,56 * * * *',
    'lifecycle','9,24,39,54 * * * *'
  ),now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='core_cron');
end $$;

revoke execute on function public.firewatch_acquire_telegram_lease(text,integer) from public,anon,authenticated;
revoke execute on function public.firewatch_release_telegram_lease(text) from public,anon,authenticated;
revoke execute on function public.firewatch_complete_bootstrap(integer) from public,anon,authenticated;
revoke execute on function public.set_fire_event_notification_required() from public,anon,authenticated;
revoke execute on function public.firewatch_refresh_lifecycle() from public,anon,authenticated;
revoke execute on function public.firewatch_configure_core_cron(text) from public,anon,authenticated;

grant execute on function public.firewatch_acquire_telegram_lease(text,integer) to service_role;
grant execute on function public.firewatch_release_telegram_lease(text) to service_role;
grant execute on function public.firewatch_complete_bootstrap(integer) to service_role;
grant execute on function public.set_fire_event_notification_required() to service_role;
grant execute on function public.firewatch_refresh_lifecycle() to service_role;
grant execute on function public.firewatch_configure_core_cron(text) to service_role;
