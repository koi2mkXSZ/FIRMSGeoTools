-- Stage 39: expose live priority inside event dossier
create or replace function public.firewatch_dossier(p_query text default null)
returns jsonb language plpgsql security definer set search_path='public','extensions','pg_temp' as $$
declare v_event uuid; v_event_updated timestamptz; v_built timestamptz; d jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id,updated_at into v_event,v_event_updated from public.fire_events order by last_seen desc limit 1;
  else
    select id,updated_at into v_event,v_event_updated from public.fire_events where lower(id::text) like lower(trim(p_query)) || '%' order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;
  select built_at,dossier into v_built,d from public.event_osint_dossiers where fire_event_id=v_event;
  if d is null or v_built is null or v_built<v_event_updated or v_built<now()-interval '30 minutes' then
    d:=public.firewatch_refresh_event_dossier(v_event);
  end if;
  return coalesce(d,'{}'::jsonb) || jsonb_build_object('priority',public.firewatch_event_priority(v_event));
end;
$$;
revoke all on function public.firewatch_dossier(text) from public,anon,authenticated;
grant execute on function public.firewatch_dossier(text) to service_role;
