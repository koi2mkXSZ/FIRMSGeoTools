-- Stage 40.3 — Air-threat / UAV Context Fusion
-- 2026-09-24
-- Regional/temporal context only. No route, heading, target or future movement output.

CREATE OR REPLACE FUNCTION public.firewatch_air_context(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid;
  e public.fire_events%rowtype;
  coverage_start timestamptz;
  state_at_event boolean;
  nearest_alert_start timestamptz;
  nearest_alert_delta double precision;
  alert_relation text;
  threat_count integer:=0;
  threat_types text[]:='{}';
  threat_sources text[]:='{}';
  min_threat_offset integer;
  threat_time_bucket text;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;
  select * into e from public.fire_events where id=v_event;

  select min(observed_at) into coverage_start
  from public.air_alert_history
  where oblast_id=e.oblast_id and observed_at is not null;

  if coverage_start is null or e.first_seen<coverage_start then
    alert_relation:='history_unavailable';
  else
    select h.alert into state_at_event
    from public.air_alert_history h
    where h.oblast_id=e.oblast_id
      and h.changed_at<=e.first_seen
      and h.observed_at>=coverage_start
    order by h.changed_at desc
    limit 1;

    select h.changed_at,
           abs(extract(epoch from (h.changed_at-e.first_seen)))
    into nearest_alert_start,nearest_alert_delta
    from public.air_alert_history h
    where h.oblast_id=e.oblast_id
      and h.alert=true
      and h.observed_at>=coverage_start
      and h.changed_at between e.first_seen-interval '6 hours' and e.first_seen+interval '6 hours'
    order by abs(extract(epoch from (h.changed_at-e.first_seen)))
    limit 1;

    alert_relation:=case
      when state_at_event=true then 'during_alert'
      when nearest_alert_delta is not null and nearest_alert_delta<=1800 then 'alert_start_within_30m'
      when nearest_alert_delta is not null and nearest_alert_delta<=7200 then 'alert_start_within_2h'
      else 'no_nearby_alert' end;
  end if;

  select count(*),
         coalesce(array_agg(distinct threat_type) filter(where threat_type is not null),'{}'::text[]),
         coalesce(array_agg(distinct source_name) filter(where source_name is not null),'{}'::text[]),
         min(abs(time_offset_seconds))
  into threat_count,threat_types,threat_sources,min_threat_offset
  from public.event_air_threat_context
  where fire_event_id=v_event;

  threat_time_bucket:=case
    when threat_count=0 then 'none'
    when min_threat_offset<=1800 then 'within_30m'
    when min_threat_offset<=7200 then 'within_2h'
    when min_threat_offset<=21600 then 'within_6h'
    else 'outside_6h' end;

  return jsonb_build_object(
    'event_id',v_event,
    'air_alert',jsonb_build_object(
      'history_available',coverage_start is not null and e.first_seen>=coverage_start,
      'coverage_start',coverage_start,
      'relation',alert_relation,
      'nearest_alert_start_delta_minutes',
        case when nearest_alert_delta is null then null else round((nearest_alert_delta/300.0)::numeric)*5 end
    ),
    'public_air_threat_context',jsonb_build_object(
      'present',threat_count>0,
      'records',threat_count,
      'threat_types',threat_types,
      'sources',threat_sources,
      'time_relation',threat_time_bucket
    ),
    'combined_context',case
      when alert_relation='during_alert' and threat_count>0 then 'alert_and_public_threat_context'
      when alert_relation='during_alert' then 'air_alert_only'
      when threat_count>0 then 'public_threat_context_only'
      when alert_relation='history_unavailable' then 'insufficient_alert_history'
      else 'no_context_detected'
    end,
    'policy','Regional/temporal context only. This does not establish causation, attribution, target, route, heading, or future movement.'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_air_context_health()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
  'current_rows',(select count(*) from public.air_alert_current),
  'current_unmapped',(select count(*) from public.air_alert_current where oblast_id is null),
  'current_latest_check',(select max(checked_at) from public.air_alert_current),
  'history_rows',(select count(*) from public.air_alert_history),
  'history_mapped',(select count(*) from public.air_alert_history where oblast_id is not null),
  'history_start',(select min(observed_at) from public.air_alert_history),
  'history_end',(select max(observed_at) from public.air_alert_history),
  'event_threat_context_rows',(select count(*) from public.event_air_threat_context),
  'event_threat_context_24h',(select count(*) from public.event_air_threat_context where updated_at>now()-interval '24 hours')
);
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_deep_osint(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d jsonb; s jsonb; g jsonb; a jsonb;
begin
  d:=public.firewatch_deep_osint_stage401(p_query);
  if d is null then return null; end if;
  s:=public.firewatch_semantic_osint(p_query);
  g:=public.firewatch_osint_evidence_graph(p_query);
  a:=public.firewatch_air_context(p_query);
  return d
    || jsonb_build_object('semantic',coalesce(s,jsonb_build_object('summary',jsonb_build_object('items',0))))
    || jsonb_build_object('evidence_graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)))
    || jsonb_build_object('air_context',coalesce(a,jsonb_build_object('combined_context','unavailable')));
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_map_alert_oblast(p_provider_name text, p_provider_name_en text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with x as (
    select
      lower(trim(coalesce(p_provider_name,''))) uk,
      lower(trim(coalesce(p_provider_name_en,''))) en
  ),
  normalized as (
    select
      regexp_replace(regexp_replace(uk,'^м[.]?\s*','','i'),'\s+область$','','i') uk_base,
      regexp_replace(en,'\s+oblast$','','i') en_base,
      uk
    from x
  )
  select case
    when n.uk ~ '^м[.]?\s*київ$' then (select id from public.oblasts where name_uk='Київ' limit 1)
    else coalesce(
      (select id from public.oblasts where lower(name_uk)=n.uk_base limit 1),
      (select id from public.oblasts where lower(name)=n.uk_base limit 1),
      (select id from public.oblasts where lower(name_en)=n.en_base limit 1),
      (select id from public.oblasts where
        lower(regexp_replace(name_en,'(ska|skaia|skaya)$','','i'))=
        lower(regexp_replace(n.en_base,'(ia|a|yi|y)$','','i'))
        limit 1)
    )
  end
  from normalized n;
$function$
;



revoke all on function public.firewatch_map_alert_oblast(text,text) from public,anon,authenticated;
grant execute on function public.firewatch_map_alert_oblast(text,text) to service_role;
revoke all on function public.firewatch_air_context(text) from public,anon,authenticated;
grant execute on function public.firewatch_air_context(text) to service_role;
revoke all on function public.firewatch_air_context_health() from public,anon,authenticated;
grant execute on function public.firewatch_air_context_health() to service_role;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

update public.air_alert_current
set oblast_id=public.firewatch_map_alert_oblast(provider_name,provider_name_en)
where oblast_id is distinct from public.firewatch_map_alert_oblast(provider_name,provider_name_en);

update public.air_alert_history
set oblast_id=public.firewatch_map_alert_oblast(provider_name,provider_name_en)
where oblast_id is distinct from public.firewatch_map_alert_oblast(provider_name,provider_name_en);
