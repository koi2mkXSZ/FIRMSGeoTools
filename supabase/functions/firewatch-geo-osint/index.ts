import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const POSTPASS="https://postpass.geofabrik.de/api/interpreter";
const OVERPASS_PROBE_ENDPOINTS=["https://overpass.private.coffee/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter"] as const;
const RADIUS_M=10000;
const CACHE_DAYS=14;
const ERROR_RETRY_HOURS=6;
const MOVE_REQUERY_M=750;
const MAX_EVENTS=10;
const MAX_REFRESH=2;
const MAX_FEATURES=60;
const MAX_INFRA_FEATURES=48;
const OIM_PROFILE_VERSION="openinframap-deep-v2";

const LABEL:Record<string,string>={
  waste:"отходы/полигон",
  industrial:"промышленность",
  power:"энергетика",
  oil_gas:"нефтегазовая инфраструктура",
  storage:"резервуары/склады",
  quarry:"карьер/добыча",
  forest:"лес",
  agriculture:"сельхозземли",
  transport:"транспорт",
  aerodrome:"аэродром",
  port:"порт/гавань",
  water:"водный объект",
  settlement:"населённый пункт",
  warehouse:"склад",
  telecom:"телеком-инфраструктура",
  pipeline:"трубопровод"
};
const PRIORITY:Record<string,number>={
  waste:100,industrial:98,oil_gas:96,power:94,storage:90,quarry:88,
  warehouse:75,aerodrome:72,port:70,transport:62,telecom:61,pipeline:60,forest:58,agriculture:52,water:48,settlement:45
};
const INFRA_LABEL:Record<string,string>={
  power_line:"ЛЭП / силовая линия",
  power_cable:"силовой кабель",
  power_substation:"электроподстанция",
  power_plant:"электростанция",
  power_generator:"генератор",
  power_transformer:"трансформатор",
  power_converter:"преобразовательная станция",
  power_switch:"силовой выключатель",
  power_compensator:"компенсирующее устройство",
  petroleum_pipeline:"нефтегазовый трубопровод",
  petroleum_site:"нефтегазовый объект",
  petroleum_well:"нефтегазовая скважина",
  petroleum_storage:"нефтегазовый резервуар",
  pipeline_valve:"трубопроводная арматура",
  pipeline_pump:"насосная станция трубопровода",
  pipeline_compressor:"компрессорная станция",
  flare:"факельная установка",
  offshore_platform:"морская платформа",
  telecom_line:"линия связи",
  telecom_data_center:"дата-центр / телеком-объект",
  telecom_mast:"телеком-мачта",
  telecom_antenna:"антенна",
  water_treatment:"водоподготовка",
  wastewater_plant:"очистные сооружения",
  pumping_station:"насосная станция",
  water_reservoir:"резервуар воды",
  water_pipeline:"водный трубопровод",
  other_pipeline:"прочий трубопровод"
};
const PETROLEUM_SUBSTANCES=new Set(["natural_gas","gas","oil","fuel","cng","lpg","ngl","lng","y-grade","hydrocarbons","hydrogen","ethylene","ethene","propylene","propene","methane","ethane","isobutane","butane","propane","condensate","butadiene","naphtha"]);
const WATER_SUBSTANCES=new Set(["water","hot_water","rainwater","wastewater","sewage","waterwaste","steam"]);
const PETROLEUM_INDUSTRIAL=new Set(["oil","fracking","oil_storage","petroleum_terminal","hydrocarbons","oil sands","oil_sands","gas","gas_storage","natural_gas","wellsite","well_cluster","refinery"]);

type Feature={
  category:string;
  label:string;
  name:string;
  distance_m:number;
  osm_type:string;
  osm_id:number;
  latitude:number;
  longitude:number;
  tags:Record<string,string>;
  infra_type?:string|null;
  infra_label?:string|null;
  profile?:Record<string,string|number|null>;
};

function json(x:unknown,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
function num(v:any){const x=Number(v);return Number.isFinite(x)?x:null}
function havM(lat1:number,lon1:number,lat2:number,lon2:number){
  const p=Math.PI/180,R=6371000,dlat=(lat2-lat1)*p,dlon=(lon2-lon1)*p;
  const a=Math.sin(dlat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
function category(tags:Record<string,string>){
  if(tags.landuse==="landfill"||tags.amenity==="waste_disposal"||tags.amenity==="waste_transfer_station")return"waste";
  if(tags.landuse==="industrial"||tags.man_made==="works"||Boolean(tags.industrial))return"industrial";
  if(tags.power==="plant"||tags.power==="substation")return"power";
  if(tags.man_made==="petroleum_well"||["oil","gas","petroleum"].includes(String(tags.industrial??""))||["oil","gas","petroleum"].includes(String(tags.substance??"")))return"oil_gas";
  if(tags.man_made==="storage_tank"||tags.man_made==="silo")return"storage";
  if(tags.landuse==="quarry"||tags.man_made==="mine")return"quarry";
  if(tags.building==="warehouse")return"warehouse";
  if(tags.aeroway==="aerodrome")return"aerodrome";
  if(tags.harbour==="yes"||tags["seamark:type"]==="harbour")return"port";
  if(tags.railway==="rail"||["motorway","trunk","primary","secondary"].includes(String(tags.highway??"")))return"transport";
  if(tags.natural==="wood"||tags.landuse==="forest")return"forest";
  if(["farmland","meadow","orchard","vineyard","greenhouse_horticulture"].includes(String(tags.landuse??"")))return"agriculture";
  if(tags.natural==="water"||["river","canal"].includes(String(tags.waterway??"")))return"water";
  if(["city","town","village","hamlet"].includes(String(tags.place??"")))return"settlement";
  return null;
}
function infraType(t:Record<string,string>){
  const power=String(t.power??t["construction:power"]??t["disused:power"]??"");
  if(["line","minor_line"].includes(power))return"power_line";
  if(["cable","minor_cable"].includes(power))return"power_cable";
  if(power==="substation")return"power_substation";
  if(power==="plant")return"power_plant";
  if(power==="generator")return"power_generator";
  if(power==="transformer")return"power_transformer";
  if(power==="converter")return"power_converter";
  if(power==="switch")return"power_switch";
  if(power==="compensator")return"power_compensator";

  const man=String(t.man_made??t["construction:man_made"]??"");
  const substance=String(t.substance??t.type??"").toLowerCase();
  const pipeline=String(t.pipeline??"").toLowerCase();
  if(man==="pipeline"){
    if(PETROLEUM_SUBSTANCES.has(substance))return"petroleum_pipeline";
    if(WATER_SUBSTANCES.has(substance))return"water_pipeline";
    return"other_pipeline";
  }
  if(pipeline==="valve")return"pipeline_valve";
  if(["pump","pumping_station"].includes(pipeline)||String(t.pumping_station??"").toLowerCase().includes("pipeline"))return"pipeline_pump";
  if(["compressor","compressor_station"].includes(pipeline))return"pipeline_compressor";
  if(PETROLEUM_INDUSTRIAL.has(String(t.industrial??"").toLowerCase())||pipeline==="substation")return"petroleum_site";
  if(["petroleum_well","oil_well"].includes(man))return"petroleum_well";
  if(man==="storage_tank"&&PETROLEUM_SUBSTANCES.has(substance))return"petroleum_storage";
  if(man==="flare"||t.industrial==="flare")return"flare";
  if(man==="offshore_platform")return"offshore_platform";

  const communication=String(t.communication??t["construction:communication"]??"");
  if(["line","cable"].includes(communication))return"telecom_line";
  if(["data_center","data_centre","telephone_exchange"].includes(String(t.building??""))||
     ["data_center","data_centre","central_office","exchange"].includes(String(t.telecom??""))||
     t.office==="telecommunication"||man==="telephone_office")return"telecom_data_center";
  if(["mast","tower","communications_tower"].includes(man)||t["tower:type"]==="communication")return"telecom_mast";
  if(man==="antenna")return"telecom_antenna";

  if(["water_works","desalination_plant"].includes(man))return"water_treatment";
  if(man==="wastewater_plant")return"wastewater_plant";
  if(man==="pumping_station")return"pumping_station";
  if(man==="reservoir_covered"||t.water==="reservoir")return"water_reservoir";
  if(t.waterway==="pressurised")return"water_pipeline";
  return null;
}
function categoryForInfra(type:string){
  if(type.startsWith("power_"))return"power";
  if(type.startsWith("petroleum_")||type.startsWith("pipeline_")||type==="flare"||type==="offshore_platform")return"oil_gas";
  if(type.startsWith("telecom_"))return"telecom";
  if(["water_treatment","wastewater_plant","pumping_station","water_reservoir","water_pipeline"].includes(type))return"water";
  if(type==="other_pipeline")return"pipeline";
  return null;
}
function infraProfile(type:string,t:Record<string,string>){
  const o:Record<string,string|number|null>={};
  const put=(k:string,v:unknown)=>{if(v!=null&&String(v)!=="")o[k]=String(v).slice(0,180)};
  put("operator",t.operator);put("operator_wikidata",t["operator:wikidata"]);put("ref",t.ref);put("wikidata",t.wikidata);put("wikipedia",t.wikipedia);put("start_date",t.start_date);put("location",t.location);
  if(type.startsWith("power_")){
    put("voltage",t.voltage);put("frequency",t.frequency);put("circuits",t.circuits);
    put("source",t["plant:source"]??t["generator:source"]);put("method",t["plant:method"]??t["generator:method"]);
    put("output",t["plant:output:electricity"]??t["generator:output:electricity"]);
    put("transformer",t.transformer);put("rating",t.rating);put("construction",t["construction:power"]);put("disused",t["disused:power"]??t.disused);
  }
  if(type.includes("pipeline")||type.startsWith("petroleum_")||type==="offshore_platform"){
    put("substance",t.substance);put("usage",t.usage);put("diameter",t.diameter);put("pressure",t.pressure);put("material",t.material);put("industrial",t.industrial);put("pipeline",t.pipeline);
  }
  if(type.startsWith("telecom_")){put("telecom",t.telecom);put("communication",t.communication);put("building",t.building);put("tower_type",t["tower:type"])}
  if(["water_treatment","wastewater_plant","pumping_station","water_reservoir","water_pipeline"].includes(type)){
    put("substance",t.substance);put("pumping_station",t.pumping_station);put("water",t.water);put("waterway",t.waterway);
  }
  return o;
}
function openInfraMapUrl(lat:number,lon:number){return `https://openinframap.org/#14/${lat.toFixed(5)}/${lon.toFixed(5)}/A,B,I,L,O,P,T,W`}
function featureName(cat:string,t:Record<string,string>){
  return String(t["name:ru"]||t["name:uk"]||t.name||t.operator||t.brand||LABEL[cat]||cat).slice(0,140);
}
function selectedTags(t:Record<string,string>){
  const keys=["name","name:ru","name:uk","landuse","amenity","industrial","power","construction:power","disused:power","man_made","construction:man_made","substance","type","usage","diameter","pressure","material","natural","water","waterway","railway","highway","aeroway","harbour","seamark:type","place","building","operator","operator:wikidata","brand","ref","wikidata","wikipedia","website","contact:website","start_date","voltage","frequency","circuits","plant:source","plant:method","plant:output:electricity","generator:source","generator:method","generator:type","generator:output:electricity","transformer","rating","location","capacity","volume","content","pipeline:diameter","pipeline:pressure","pipeline:substance","communication","construction:communication","telecom","office","tower:type","pipeline","pumping_station","disused"];
  const o:Record<string,string>={};
  for(const k of keys)if(t[k]!=null)o[k]=String(t[k]).slice(0,240);
  return o;
}
function postpassSql(lat:number,lon:number){
  const dLat=RADIUS_M/111320;
  const dLon=RADIUS_M/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
  const minLon=(lon-dLon).toFixed(6),maxLon=(lon+dLon).toFixed(6),minLat=(lat-dLat).toFixed(6),maxLat=(lat+dLat).toFixed(6);
  const pLon=lon.toFixed(7),pLat=lat.toFixed(7);
  return `
WITH p AS (
  SELECT ST_SetSRID(ST_MakePoint(${pLon},${pLat}),4326) AS event_geom
), q AS (
  SELECT
    osm_id,
    osm_type,
    tags,
    ST_ClosestPoint(geom,p.event_geom) AS geom,
    ST_Distance(geom::geography,p.event_geom::geography) AS distance_m
  FROM postpass_pointlinepolygon,p
  WHERE geom && ST_MakeEnvelope(${minLon},${minLat},${maxLon},${maxLat},4326)
    AND (
      tags->>'landuse' IN ('industrial','landfill','quarry','forest','farmland','meadow','orchard','vineyard','greenhouse_horticulture')
      OR tags->>'amenity' IN ('waste_disposal','waste_transfer_station')
      OR tags->>'power' IN ('line','minor_line','cable','minor_cable','plant','substation','generator','transformer','converter','switch','compensator')
      OR tags->>'construction:power' IN ('line','minor_line','cable','minor_cable','plant','substation','generator','converter')
      OR tags->>'disused:power' IN ('line','minor_line','cable','minor_cable')
      OR tags->>'man_made' IN ('works','petroleum_well','oil_well','offshore_platform','storage_tank','silo','mine','pipeline','flare','water_works','desalination_plant','wastewater_plant','pumping_station','water_tower','water_well','reservoir_covered','mast','tower','communications_tower','antenna','telephone_office')
      OR tags->>'construction:man_made'='pipeline'
      OR tags ? 'industrial'
      OR tags->>'pipeline' IN ('substation','valve','flare','pump','pumping_station','compressor','compressor_station')
      OR tags->>'communication' IN ('line','cable')
      OR tags->>'construction:communication' IN ('line','cable')
      OR tags->>'building' IN ('warehouse','data_center','data_centre','telephone_exchange')
      OR tags->>'telecom' IN ('data_center','data_centre','central_office','exchange')
      OR tags->>'office'='telecommunication'
      OR tags->>'tower:type'='communication'
      OR tags->>'railway'='rail'
      OR tags->>'highway' IN ('motorway','trunk','primary','secondary')
      OR tags->>'aeroway'='aerodrome'
      OR tags->>'harbour'='yes'
      OR tags->>'seamark:type'='harbour'
      OR tags->>'natural' IN ('wood','water')
      OR tags->>'water'='reservoir'
      OR tags->>'waterway' IN ('river','canal','pressurised')
      OR tags->>'place' IN ('city','town','village','hamlet')
    )
)
SELECT osm_id,osm_type,tags,geom,distance_m
FROM q
WHERE distance_m <= ${RADIUS_M}
ORDER BY distance_m
LIMIT 1500
`;
}
function overpassProbeQuery(lat:number,lon:number){
  const dLat=RADIUS_M/111320,dLon=RADIUS_M/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
  const bbox=`${(lat-dLat).toFixed(6)},${(lon-dLon).toFixed(6)},${(lat+dLat).toFixed(6)},${(lon+dLon).toFixed(6)}`;
  return `[out:json][timeout:12];(
nwr["landuse"~"^(industrial|landfill|quarry|forest|farmland|meadow|orchard|vineyard|greenhouse_horticulture)$"](${bbox});
nwr["amenity"~"^(waste_disposal|waste_transfer_station)$"](${bbox});
nwr["power"~"^(plant|substation)$"](${bbox});
nwr["man_made"~"^(works|petroleum_well|storage_tank|silo|mine)$"](${bbox});
nwr["industrial"](${bbox});
nwr["building"="warehouse"](${bbox});
nwr["railway"="rail"](${bbox});
nwr["highway"~"^(motorway|trunk|primary|secondary)$"](${bbox});
nwr["aeroway"="aerodrome"](${bbox});
nwr["harbour"="yes"](${bbox});
nwr["seamark:type"="harbour"](${bbox});
nwr["natural"~"^(wood|water)$"](${bbox});
nwr["waterway"~"^(river|canal)$"](${bbox});
nwr["place"~"^(city|town|village|hamlet)$"](${bbox});
);out center tags qt;`;
}
async function probeOverpass(endpoint:string,lat:number,lon:number){
  const q=overpassProbeQuery(lat,lon),started=performance.now();
  try{
    const r=await fetch(endpoint,{
      method:"POST",
      headers:{
        "accept":"application/json",
        "content-type":"application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent":"GeoWatch-GeoOSINT/1.0 (@NASA_FIRMS; Stage27.1 probe)"
      },
      body:new URLSearchParams([["data",q]]),
      signal:AbortSignal.timeout(18000)
    });
    const text=await r.text(),latency_ms=Math.round(performance.now()-started);
    let count:null|number=null,timestamp_osm_base:null|string=null,parse_error:null|string=null;
    if(r.ok){try{const d=JSON.parse(text);count=Array.isArray(d?.elements)?d.elements.length:null;timestamp_osm_base=d?.osm3s?.timestamp_osm_base??null}catch(e){parse_error=e instanceof Error?e.message:String(e)}}
    return{endpoint,http_status:r.status,ok:r.ok,latency_ms,count,timestamp_osm_base,bytes:new TextEncoder().encode(text).length,parse_error,error:r.ok?null:text.slice(0,300)};
  }catch(e){return{endpoint,http_status:null,ok:false,latency_ms:Math.round(performance.now()-started),count:null,timestamp_osm_base:null,bytes:0,parse_error:null,error:e instanceof Error?e.message:String(e)}}
}
async function probeOverpassLite(endpoint:string,lat:number,lon:number){
  const q=`[out:json][timeout:5];node(around:100,${lat},${lon});out count;`;
  const started=performance.now();
  try{
    const u=endpoint+"?data="+encodeURIComponent(q);
    const r=await fetch(u,{
      method:"GET",
      headers:{"accept":"application/json","user-agent":"GeoWatch-GeoOSINT/1.0 (@NASA_FIRMS; Stage27.1 lite probe)"},
      signal:AbortSignal.timeout(8000)
    });
    const text=await r.text(),latency_ms=Math.round(performance.now()-started);
    let count:null|number=null,parse_error:null|string=null;
    if(r.ok){try{const d=JSON.parse(text),tags=d?.elements?.[0]?.tags;count=Number(tags?.nodes??tags?.total??0)}catch(e){parse_error=e instanceof Error?e.message:String(e)}}
    return{endpoint,http_status:r.status,ok:r.ok,latency_ms,count,bytes:new TextEncoder().encode(text).length,parse_error,error:r.ok?null:text.slice(0,240)};
  }catch(e){return{endpoint,http_status:null,ok:false,latency_ms:Math.round(performance.now()-started),count:null,bytes:0,parse_error:null,error:e instanceof Error?e.message:String(e)}}
}
async function probePostpass(lat:number,lon:number){
  const started=performance.now();
  try{const d=await postpass(lat,lon);return{endpoint:POSTPASS,ok:true,latency_ms:Math.round(performance.now()-started),count:Array.isArray(d?.features)?d.features.length:null,error:null}}
  catch(e){return{endpoint:POSTPASS,ok:false,latency_ms:Math.round(performance.now()-started),count:null,error:e instanceof Error?e.message:String(e)}}
}
async function postpass(lat:number,lon:number){
  const sql=postpassSql(lat,lon);
  const r=await fetch(POSTPASS,{
    method:"POST",
    headers:{
      "accept":"application/json",
      "content-type":"application/x-www-form-urlencoded",
      "user-agent":"GeoWatch-GeoOSINT/1.0 (@NASA_FIRMS; low-volume event cache)"
    },
    body:new URLSearchParams([["data",sql]]),
    signal:AbortSignal.timeout(25000)
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Postpass HTTP ${r.status}: ${text.slice(0,300)}`);
  let data:any;try{data=JSON.parse(text)}catch{throw new Error("Postpass invalid JSON: "+text.slice(0,220))}
  return data;
}
async function fetchContext(lat:number,lon:number){
  try{
    const data=await postpass(lat,lon);
    const input=Array.isArray(data?.features)?data.features:[];
    const all:Feature[]=[];
    for(const row of input){
      const p=row?.properties??{},t=(p?.tags??{}) as Record<string,string>,infra=infraType(t);
      const cat=category(t)??(infra?categoryForInfra(infra):null);if(!cat)continue;
      const coords=row?.geometry?.type==="Point"?row.geometry.coordinates:null;
      const elon=num(coords?.[0]),elat=num(coords?.[1]);if(elat==null||elon==null)continue;
      const d=num(p?.distance_m)??Math.round(havM(lat,lon,elat,elon));if(d>RADIUS_M+100)continue;
      all.push({category:cat,label:LABEL[cat]??cat,name:featureName(cat,t),distance_m:Math.round(d),osm_type:String(p?.osm_type??""),osm_id:Number(p?.osm_id??0),latitude:elat,longitude:elon,tags:selectedTags(t),infra_type:infra,infra_label:infra?INFRA_LABEL[infra]??infra:null,profile:infra?infraProfile(infra,t):undefined});
    }
    const dedup=new Map<string,Feature>();
    for(const f of all){const k=f.category+":"+f.osm_type+":"+f.osm_id,old=dedup.get(k);if(!old||f.distance_m<old.distance_m)dedup.set(k,f)}
    const sorted=[...dedup.values()].sort((a,b)=>a.distance_m-b.distance_m);
    const per=new Map<string,number>(),features:Feature[]=[];
    for(const f of sorted){const n=per.get(f.category)??0;if(n>=3)continue;per.set(f.category,n+1);features.push(f);if(features.length>=MAX_FEATURES)break}
    const cats:Record<string,number>={};for(const f of sorted)cats[f.category]=(cats[f.category]??0)+1;
    const infraAll=sorted.filter(f=>Boolean(f.infra_type));
    const infraCounts:Record<string,number>={};for(const f of infraAll)infraCounts[String(f.infra_type)]=(infraCounts[String(f.infra_type)]??0)+1;
    const infraPer=new Map<string,number>(),infrastructureFeatures:Feature[]=[];
    for(const f of infraAll){const k=String(f.infra_type),n=infraPer.get(k)??0;if(n>=3)continue;infraPer.set(k,n+1);infrastructureFeatures.push(f);if(infrastructureFeatures.length>=MAX_INFRA_FEATURES)break}
    const nearest=features[0]??null,nearestInfra=infrastructureFeatures[0]??null;
    const radii=[500,1000,2000,5000,10000];
    const rings:Record<string,any>={};
    for(const radius of radii){
      const inside=infraAll.filter(f=>f.distance_m<=radius);
      const byType:Record<string,number>={},byCategory:Record<string,number>={};
      for(const f of inside){
        const it=String(f.infra_type??"other"),cat=String(f.category??"other");
        byType[it]=(byType[it]??0)+1;byCategory[cat]=(byCategory[cat]??0)+1;
      }
      rings[String(radius)]={total:inside.length,by_type:byType,by_category:byCategory};
    }
    const nearestByType:Record<string,any>={};
    for(const f of infraAll){
      const k=String(f.infra_type??"other");
      if(!nearestByType[k])nearestByType[k]={name:f.name,distance_m:f.distance_m,osm_type:f.osm_type,osm_id:f.osm_id,profile:f.profile??{}};
    }
    const voltageOf=(f:Feature)=>{
      const raw=String((f.profile as any)?.voltage??f.tags?.voltage??"");
      const vals=raw.split(";").map(x=>Number(x)).filter(Number.isFinite);
      return vals.length?Math.max(...vals):null;
    };
    const majorPower=infraAll.filter(f=>["power_line","power_cable","power_substation","power_plant"].includes(String(f.infra_type))&&(voltageOf(f)??0)>=110000);
    const petroleum=infraAll.filter(f=>["petroleum_pipeline","petroleum_site","petroleum_well","petroleum_storage","pipeline_pump","pipeline_compressor","flare","offshore_platform"].includes(String(f.infra_type)));
    const flags:string[]=[];
    if(infraAll.some(f=>["power_line","power_cable"].includes(String(f.infra_type))&&f.distance_m<=500))flags.push("near_power_line_500m");
    if(infraAll.some(f=>String(f.infra_type).startsWith("power_")&&f.distance_m<=2000))flags.push("near_power_infrastructure_2km");
    if(infraAll.some(f=>["petroleum_pipeline","other_pipeline"].includes(String(f.infra_type))&&f.distance_m<=1000))flags.push("near_pipeline_1km");
    if(petroleum.some(f=>f.distance_m<=2000))flags.push("near_petroleum_infrastructure_2km");
    if(features.some(f=>f.category==="industrial"&&f.distance_m<=2000))flags.push("near_industrial_2km");
    if(majorPower.some(f=>f.distance_m<=5000))flags.push("major_power_5km");
    if(infraAll.some(f=>String(f.infra_type).startsWith("telecom_")&&f.distance_m<=1000))flags.push("telecom_infrastructure_1km");
    if(infraAll.some(f=>["water_treatment","wastewater_plant","pumping_station","water_reservoir","water_pipeline"].includes(String(f.infra_type))&&f.distance_m<=1000))flags.push("water_infrastructure_1km");
    const summary={
      nearest_by_type:nearestByType,
      major_power_nearest:majorPower[0]??null,
      petroleum_nearest:petroleum[0]??null,
      high_voltage_count_10km:majorPower.length,
      infrastructure_total_10km:infraAll.length
    };
    return{ok:true,endpoint:POSTPASS,method:"POST",osm_base_at:null,feature_count:sorted.length,context_type:nearest?(LABEL[nearest.category]??nearest.category):null,nearest_feature:nearest?.name??null,nearest_feature_distance_m:nearest?.distance_m??null,categories:cats,features,infra_profile_version:OIM_PROFILE_VERSION,infrastructure_counts:infraCounts,infrastructure_features:infrastructureFeatures,nearest_infrastructure:nearestInfra,infrastructure_summary:summary,infrastructure_rings:rings,infrastructure_context_flags:flags,openinframap_url:openInfraMapUrl(lat,lon)};
  }catch(e){return{ok:false,errors:[e instanceof Error?e.message:String(e)]}}
}
function cacheFresh(cache:any,lat:number,lon:number){
  if(!cache)return false;
  if(String(cache.infra_profile_version??"")!==OIM_PROFILE_VERSION)return false;
  const age=Date.now()-Date.parse(String(cache.queried_at??""));
  const clat=num(cache.query_latitude),clon=num(cache.query_longitude);
  if(clat==null||clon==null||!Number.isFinite(age))return false;
  const moved=havM(clat,clon,lat,lon);
  if(cache.last_error)return moved<MOVE_REQUERY_M&&age<ERROR_RETRY_HOURS*3600000;
  return moved<MOVE_REQUERY_M&&age<CACHE_DAYS*86400000;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"missing env"},500);
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:auth,error:ae}=await sb.rpc("verify_firewatch_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(ae||auth!==true)return json({ok:false,error:"unauthorized"},401);
  let body:any={};try{body=await req.json()}catch{}
  if(body?.mode==="probe"||body?.mode==="probe-lite"){
    const {data:row,error:re}=await sb.from("geo_osint_event_cache").select("fire_event_id,query_latitude,query_longitude,feature_count").is("last_error",null).order("queried_at",{ascending:false}).limit(1).maybeSingle();
    if(re)return json({ok:false,error:re.message},502);
    if(!row)return json({ok:false,error:"no healthy geo cache row available"},404);
    const lat=Number((row as any).query_latitude),lon=Number((row as any).query_longitude);
    const postpass=await probePostpass(lat,lon);
    const overpass=[] as any[];
    for(const endpoint of OVERPASS_PROBE_ENDPOINTS)overpass.push(body?.mode==="probe-lite"?await probeOverpassLite(endpoint,lat,lon):await probeOverpass(endpoint,lat,lon));
    return json({ok:true,mode:body?.mode,event_id:(row as any).fire_event_id,reference_cache_count:(row as any).feature_count,radius_m:RADIUS_M,postpass,overpass});
  }

  const {data:events,error}=await sb.from("fire_events")
    .select("id,status,lifecycle_status,last_seen,best_latitude,best_longitude,last_latitude,last_longitude")
    .gte("last_seen",new Date(Date.now()-24*3600e3).toISOString())
    .order("last_seen",{ascending:false}).limit(20);
  if(error)return json({ok:false,error:error.message},502);

  const candidates=(events??[]).filter((e:any)=>e.status!=="closed"&&e.lifecycle_status!=="closed").slice(0,MAX_EVENTS);
  const ids=candidates.map((e:any)=>e.id);
  const {data:caches,error:ce}=ids.length?await sb.from("geo_osint_event_cache").select("*").in("fire_event_id",ids):{data:[],error:null} as any;
  if(ce)return json({ok:false,error:ce.message},502);
  const cacheMap=new Map((caches??[]).map((x:any)=>[String(x.fire_event_id),x]));
  const prior=(await sb.from("system_state").select("value").eq("key","monitor_geo_osint").maybeSingle()).data?.value??{};

  let cacheHits=0,attempted=0,refreshed=0,failed=0,featuresStored=0,infrastructureStored=0,eventsWithInfrastructure=0;
  const warnings:string[]=[];
  for(const e of candidates){
    const lat=num((e as any).best_latitude??(e as any).last_latitude),lon=num((e as any).best_longitude??(e as any).last_longitude);
    if(lat==null||lon==null)continue;
    const old=cacheMap.get(String((e as any).id));
    if(cacheFresh(old,lat,lon)){cacheHits++;continue}
    if(attempted>=MAX_REFRESH)continue;
    attempted++;
    const result:any=await fetchContext(lat,lon);
    if(result.ok){
      refreshed++;featuresStored+=Number(result.features?.length??0);infrastructureStored+=Number(result.infrastructure_features?.length??0);if(Number(result.infrastructure_features?.length??0)>0)eventsWithInfrastructure++;
      const now=new Date().toISOString();
      const {error:ue}=await sb.from("geo_osint_event_cache").upsert({
        fire_event_id:(e as any).id,queried_at:now,query_latitude:lat,query_longitude:lon,
        query_location:`POINT(${lon} ${lat})`,query_radius_m:RADIUS_M,
        osm_base_at:null,endpoint:result.endpoint,endpoint_method:result.method,
        feature_count:result.feature_count,context_type:result.context_type,
        nearest_feature:result.nearest_feature,nearest_feature_distance_m:result.nearest_feature_distance_m,
        categories:result.categories,features:result.features,
        infra_profile_version:result.infra_profile_version,infrastructure_counts:result.infrastructure_counts,
        infrastructure_features:result.infrastructure_features,nearest_infrastructure:result.nearest_infrastructure,
        infrastructure_summary:result.infrastructure_summary??{},infrastructure_rings:result.infrastructure_rings??{},
        infrastructure_context_flags:result.infrastructure_context_flags??[],
        openinframap_url:result.openinframap_url,last_error:null,updated_at:now
      });
      if(ue)warnings.push("cache "+String((e as any).id).slice(0,8)+": "+ue.message);
      else{
        const legacy=(result.features??[]).slice(0,5).map((f:any)=>({category:f.category,label:f.label,name:f.name,distance_m:f.distance_m,osm_type:f.osm_type,osm_id:f.osm_id}));
        const {error:fe}=await sb.from("fire_events").update({
          osm_context_type:result.context_type,osm_context_score:null,
          osm_nearest_feature:result.nearest_feature,osm_nearest_feature_distance_m:result.nearest_feature_distance_m,
          osm_features:legacy,osm_context_latitude:lat,osm_context_longitude:lon,osm_context_updated_at:now
        }).eq("id",(e as any).id);
        if(fe)warnings.push("legacy "+String((e as any).id).slice(0,8)+": "+fe.message);
      }
    }else{
      failed++;const msg=(result.errors??[]).join(" | ").slice(0,1800);warnings.push(String((e as any).id).slice(0,8)+": "+msg);
      const now=new Date().toISOString();
      const row:any={fire_event_id:(e as any).id,queried_at:now,query_latitude:lat,query_longitude:lon,query_location:`POINT(${lon} ${lat})`,query_radius_m:RADIUS_M,last_error:msg,updated_at:now};
      if(old){
        row.osm_base_at=old.osm_base_at;row.endpoint=old.endpoint;row.endpoint_method=old.endpoint_method;
        row.feature_count=old.feature_count??0;row.context_type=old.context_type??null;row.nearest_feature=old.nearest_feature??null;
        row.nearest_feature_distance_m=old.nearest_feature_distance_m??null;row.categories=old.categories??{};row.features=old.features??[];
        row.infra_profile_version=old.infra_profile_version??OIM_PROFILE_VERSION;row.infrastructure_counts=old.infrastructure_counts??{};
        row.infrastructure_features=old.infrastructure_features??[];row.nearest_infrastructure=old.nearest_infrastructure??null;
        row.infrastructure_summary=old.infrastructure_summary??{};row.infrastructure_rings=old.infrastructure_rings??{};
        row.infrastructure_context_flags=old.infrastructure_context_flags??[];row.openinframap_url=old.openinframap_url??openInfraMapUrl(lat,lon);
      }
      await sb.from("geo_osint_event_cache").upsert(row);
    }
  }

  const {data:currentCache}=ids.length?await sb.from("geo_osint_event_cache").select("fire_event_id,infrastructure_features,infra_profile_version").in("fire_event_id",ids):{data:[]} as any;
  const infraReady=(currentCache??[]).filter((x:any)=>String(x.infra_profile_version??"")===OIM_PROFILE_VERSION);
  const eventsWithInfrastructureTotal=infraReady.filter((x:any)=>Array.isArray(x.infrastructure_features)&&x.infrastructure_features.length>0).length;
  const infrastructureRetainedTotal=infraReady.reduce((a:number,x:any)=>a+(Array.isArray(x.infrastructure_features)?x.infrastructure_features.length:0),0);
  const consecutive=attempted>0&&failed===attempted?Number(prior?.consecutive_failed_cycles??0)+1:0;
  const status=consecutive>=3?"degraded":"active";
  const state={
    status,source:"OpenStreetMap via Geofabrik Postpass event cache",
    last_check:new Date().toISOString(),last_success_run:status==="active"?new Date().toISOString():prior?.last_success_run??null,
    event_window_hours:24,query_radius_m:RADIUS_M,cache_days:CACHE_DAYS,error_retry_hours:ERROR_RETRY_HOURS,
    move_requery_m:MOVE_REQUERY_M,max_events:MAX_EVENTS,max_refresh_per_cycle:MAX_REFRESH,
    endpoint:POSTPASS,events_considered:candidates.length,cache_hits:cacheHits,queries_attempted:attempted,
    refreshed,failed,features_cached:featuresStored,infrastructure_features_cached:infrastructureStored,events_with_infrastructure:eventsWithInfrastructure,events_with_infrastructure_total:eventsWithInfrastructureTotal,infrastructure_features_retained_total:infrastructureRetainedTotal,infra_profile_version:OIM_PROFILE_VERSION,consecutive_failed_cycles:consecutive,warnings:warnings.slice(-20),
    dependency_rule:"Geo OSINT is non-critical and uses Postpass, not GitHub Actions or live Overpass. Failures never block FIRMS/Telegram."
  };
  await sb.from("system_state").upsert({key:"monitor_geo_osint",value:state,updated_at:new Date().toISOString()});
  return json({ok:true,state});
});