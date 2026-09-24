-- Stage 39: Event Priority / Operator Triage
-- 2026-09-24
-- Priority is descriptive operator triage only. It does not infer cause, intent, attribution or military significance.

alter table public.fire_events
  add column if not exists priority_score smallint,
  add column if not exists priority_level text,
  add column if not exists priority_reasons jsonb not null default '[]'::jsonb,
  add column if not exists priority_updated_at timestamptz;

alter table public.fire_events drop constraint if exists fire_events_priority_score_check;
alter table public.fire_events add constraint fire_events_priority_score_check
  check (priority_score is null or priority_score between 0 and 100);

alter table public.fire_events drop constraint if exists fire_events_priority_level_check;
alter table public.fire_events add constraint fire_events_priority_level_check
  check (priority_level is null or priority_level in ('low','normal','elevated','high'));

create index if not exists fire_events_priority_idx
  on public.fire_events(priority_score desc,last_seen desc);

create or replace function public.firewatch_event_priority(p_event uuid)
returns jsonb
language plpgsql stable security definer
set search_path='public','extensions','pg_temp'
as $$
declare
  e public.fire_events%rowtype;
  v_frp double precision:=0; v_duration_min double precision:=0; v_pop5 double precision:=null;
  v_flags text[]:='{}'; v_classes text[]:='{}'; v_score integer:=0;
  v_confirmation integer:=0; v_thermal integer:=0; v_persistence integer:=0;
  v_dynamics integer:=0; v_civilian integer:=0; v_context integer:=0;
  v_level text; v_label text; v_reasons jsonb:='[]'::jsonb;
begin
  select * into e from public.fire_events where id=p_event;
  if not found then return null; end if;

  select greatest(
    coalesce(e.frp_latest_avg,0),
    coalesce((select max(frp) from public.detections where event_id=p_event),0),
    coalesce((select max(frp) from public.eumetsat_frp_detections where event_id=p_event),0)
  ) into v_frp;
  v_duration_min:=greatest(0,extract(epoch from (e.last_seen-e.first_seen))/60.0);
  select population_5km into v_pop5 from public.ghsl_event_cache where fire_event_id=p_event;
  select coalesce(flags,'{}'::text[]),coalesce(evidence_classes,'{}'::text[])
    into v_flags,v_classes from public.event_osint_dossiers where fire_event_id=p_event;

  v_confirmation:=case when coalesce(e.multisource_count,0)>=3 then 25 when coalesce(e.multisource_count,0)=2 then 18 when coalesce(e.multisource_count,0)=1 then 8 else 0 end;
  if v_confirmation>0 then v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('factor','satellite_confirmation','points',v_confirmation,'detail',coalesce(e.multisource_count,0)||' platform(s)')); end if;

  v_thermal:=case when v_frp>=100 then 25 when v_frp>=50 then 20 when v_frp>=20 then 14 when v_frp>=5 then 7 when v_frp>0 then 3 else 0 end;
  if v_thermal>0 then v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('factor','thermal_intensity','points',v_thermal,'detail',round(v_frp::numeric,1)||' MW')); end if;

  v_persistence:=
    case when v_duration_min>=180 then 10 when v_duration_min>=60 then 7 when v_duration_min>=15 then 4 else 0 end +
    case when coalesce(e.observation_count,0)>=10 then 10 when coalesce(e.observation_count,0)>=5 then 7 when coalesce(e.observation_count,0)>=2 then 4 when coalesce(e.observation_count,0)=1 then 1 else 0 end;
  if v_persistence>0 then v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('factor','persistence','points',v_persistence,'detail',jsonb_build_object('duration_minutes',round(v_duration_min::numeric,1),'observations',coalesce(e.observation_count,0)))); end if;

  v_dynamics:=case when lower(coalesce(e.frp_trend,'')) in ('strengthening','rising','increase','increasing') then 8 when lower(coalesce(e.frp_trend,'')) in ('stable','steady') then 3 else 0 end
    + case when coalesce(e.cluster_diameter_m,0)>=1000 then 2 else 0 end;
  v_dynamics:=least(10,v_dynamics);
  if v_dynamics>0 then v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('factor','dynamics','points',v_dynamics,'detail',jsonb_build_object('frp_trend',e.frp_trend,'cluster_diameter_m',e.cluster_diameter_m))); end if;

  v_civilian:=case when coalesce(v_pop5,0)>=50000 then 10 when coalesce(v_pop5,0)>=10000 then 8 when coalesce(v_pop5,0)>=1000 then 5 when coalesce(v_pop5,0)>0 then 2 else 0 end
    + case when 'settlement_near_2km'=any(v_flags) then 5 else 0 end;
  v_civilian:=least(15,v_civilian);
  if v_civilian>0 then v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('factor','civilian_context','points',v_civilian,'detail',jsonb_build_object('population_5km',v_pop5,'settlement_near_2km','settlement_near_2km'=any(v_flags)))); end if;

  v_context:=least(5,
    (case when 'external_osint'=any(v_classes) then 2 else 0 end)+
    (case when 'public_telegram'=any(v_classes) then 1 else 0 end)+
    (case when 'ground'=any(v_classes) then 1 else 0 end)+
    (case when 'atmosphere'=any(v_classes) then 1 else 0 end)
  );
  if v_context>0 then v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('factor','independent_context','points',v_context,'detail',jsonb_build_object('external_osint','external_osint'=any(v_classes),'public_telegram','public_telegram'=any(v_classes),'ground','ground'=any(v_classes),'atmosphere','atmosphere'=any(v_classes)))); end if;

  v_score:=least(100,v_confirmation+v_thermal+v_persistence+v_dynamics+v_civilian+v_context);
  v_level:=case when v_score>=75 then 'high' when v_score>=55 then 'elevated' when v_score>=30 then 'normal' else 'low' end;
  v_label:=case v_level when 'high' then 'Высокий приоритет просмотра' when 'elevated' then 'Повышенный приоритет просмотра' when 'normal' then 'Обычный приоритет просмотра' else 'Низкий приоритет просмотра' end;

  return jsonb_build_object(
    'score',v_score,'level',v_level,'label',v_label,
    'components',jsonb_build_object('satellite_confirmation',v_confirmation,'thermal_intensity',v_thermal,'persistence',v_persistence,'dynamics',v_dynamics,'civilian_context',v_civilian,'independent_context',v_context),
    'reasons',v_reasons,
    'policy','Operator triage only. This score does not identify cause, intent, attribution, or military significance.'
  );
end;
$$;
revoke all on function public.firewatch_event_priority(uuid) from public,anon,authenticated;
grant execute on function public.firewatch_event_priority(uuid) to service_role;

create or replace function public.firewatch_refresh_event_priority(p_event uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare p jsonb;
begin
  p:=public.firewatch_event_priority(p_event); if p is null then return null; end if;
  update public.fire_events set priority_score=(p->>'score')::smallint,priority_level=p->>'level',priority_reasons=coalesce(p->'reasons','[]'::jsonb),priority_updated_at=now() where id=p_event;
  return p;
end; $$;
revoke all on function public.firewatch_refresh_event_priority(uuid) from public,anon,authenticated;
grant execute on function public.firewatch_refresh_event_priority(uuid) to service_role;

create or replace function public.firewatch_priority_trigger()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  if tg_table_name='fire_events' then
    perform public.firewatch_refresh_event_priority(new.id);
  else
    perform public.firewatch_refresh_event_priority(new.fire_event_id);
  end if;
  return new;
end; $$;
revoke all on function public.firewatch_priority_trigger() from public,anon,authenticated;

drop trigger if exists fire_events_priority_refresh on public.fire_events;
create trigger fire_events_priority_refresh after insert or update of observation_count,multisource_count,frp_latest_avg,frp_trend,cluster_diameter_m,first_seen,last_seen on public.fire_events for each row execute function public.firewatch_priority_trigger();
drop trigger if exists ghsl_priority_refresh on public.ghsl_event_cache;
create trigger ghsl_priority_refresh after insert or update of population_5km on public.ghsl_event_cache for each row execute function public.firewatch_priority_trigger();
drop trigger if exists dossier_priority_refresh on public.event_osint_dossiers;
create trigger dossier_priority_refresh after insert or update of flags,evidence_classes on public.event_osint_dossiers for each row execute function public.firewatch_priority_trigger();

create or replace function public.firewatch_priority_events(p_hours integer default 24,p_limit integer default 20,p_min_score integer default 0)
returns jsonb language sql stable security definer set search_path='public','pg_temp' as $$
with x as (
  select e.id,e.first_seen,e.last_seen,e.lifecycle_status,e.priority_score,e.priority_level,e.priority_reasons,
         e.multisource_count,e.observation_count,e.frp_latest_avg,e.frp_trend,e.best_latitude,e.best_longitude,
         e.nearest_place_name,e.nearest_place_distance_km,o.name_uk oblast
  from public.fire_events e left join public.oblasts o on o.id=e.oblast_id
  where e.last_seen>=now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),8760)))
    and coalesce(e.priority_score,0)>=greatest(0,least(coalesce(p_min_score,0),100))
  order by e.priority_score desc nulls last,e.last_seen desc
  limit greatest(1,least(coalesce(p_limit,20),100))
)
select jsonb_build_object('hours',greatest(1,least(coalesce(p_hours,24),8760)),'min_score',greatest(0,least(coalesce(p_min_score,0),100)),'count',count(*),
'events',coalesce(jsonb_agg(jsonb_build_object('id',id,'first_seen',first_seen,'last_seen',last_seen,'lifecycle_status',lifecycle_status,'priority_score',priority_score,'priority_level',priority_level,'priority_reasons',priority_reasons,'multisource_count',multisource_count,'observation_count',observation_count,'frp_latest_avg',frp_latest_avg,'frp_trend',frp_trend,'latitude',best_latitude,'longitude',best_longitude,'nearest_place_name',nearest_place_name,'nearest_place_distance_km',nearest_place_distance_km,'oblast',oblast) order by priority_score desc nulls last,last_seen desc),'[]'::jsonb))
from x;
$$;
revoke all on function public.firewatch_priority_events(integer,integer,integer) from public,anon,authenticated;
grant execute on function public.firewatch_priority_events(integer,integer,integer) to service_role;

create or replace function public.firewatch_refresh_priority_recent(p_hours integer default 168,p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare r record; n integer:=0;
begin
  for r in select id from public.fire_events where last_seen>=now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,168),8760))) order by last_seen desc limit greatest(1,least(coalesce(p_limit,5000),10000))
  loop perform public.firewatch_refresh_event_priority(r.id); n:=n+1; end loop;
  return jsonb_build_object('ok',true,'refreshed',n,'hours',p_hours);
end; $$;
revoke all on function public.firewatch_refresh_priority_recent(integer,integer) from public,anon,authenticated;
grant execute on function public.firewatch_refresh_priority_recent(integer,integer) to service_role;
