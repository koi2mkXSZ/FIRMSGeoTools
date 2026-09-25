-- Stage 43.2 — Batch spatial gate for dynamic object search
-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 40

create or replace function public.firewatch_spatial_gate(p_points jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public','extensions','pg_temp'
as $function$
declare
  v_result jsonb;
  v_count integer;
begin
  if p_points is null or jsonb_typeof(p_points)<>'array' then
    raise exception 'p_points must be a JSON array';
  end if;

  v_count:=jsonb_array_length(p_points);
  if v_count>15000 then
    raise exception 'too many spatial gate points: %',v_count;
  end if;

  with pts as (
    select
      (ord-1)::integer as idx,
      (x->>'lat')::double precision as lat,
      (x->>'lon')::double precision as lon
    from jsonb_array_elements(p_points) with ordinality as t(x,ord)
    where jsonb_typeof(x)='object'
      and x ? 'lat' and x ? 'lon'
  ),
  gated as (
    select
      p.idx,p.lat,p.lon,
      o.id as oblast_id,o.code,o.name_uk,o.name_en
    from pts p
    left join lateral (
      select ob.id,ob.code,ob.name_uk,ob.name_en
      from public.oblasts ob
      where p.lat between -90 and 90
        and p.lon between -180 and 180
        and extensions.ST_Covers(
          ob.geom,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p.lon,p.lat),4326)
        )
      order by ob.id
      limit 1
    ) o on true
  )
  select jsonb_build_object(
    'count',count(*),
    'inside_count',count(*) filter(where oblast_id is not null),
    'points',coalesce(jsonb_agg(
      jsonb_build_object(
        'idx',idx,'lat',lat,'lon',lon,
        'inside',oblast_id is not null,
        'oblast_id',oblast_id,'oblast_code',code,
        'oblast_name_uk',name_uk,'oblast_name_en',name_en
      ) order by idx
    ),'[]'::jsonb)
  )
  into v_result
  from gated;

  return coalesce(v_result,jsonb_build_object('count',0,'inside_count',0,'points','[]'::jsonb));
end;
$function$;

revoke all on function public.firewatch_spatial_gate(jsonb) from public,anon,authenticated;
grant execute on function public.firewatch_spatial_gate(jsonb) to service_role;
