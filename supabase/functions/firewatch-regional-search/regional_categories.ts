import { diceSimilarity, normalizeRegionQuery as norm } from "./region_aliases.ts";

export type RegionalSpec={
  key:string;
  label:string;
  aliases:string[];
  osm:string;
  overture:string[];
  overtureTypes:string[];
};

export type CategoryResolution={
  mode:"canonical"|"qualified"|"fuzzy"|"semantic_hint"|"generic"|"ambiguous";
  input:string;
  normalized:string;
  confidence:number;
  matched_alias?:string|null;
  qualifier?:string|null;
  suggestions?:{key:string;label:string}[];
  spec?:RegionalSpec|null;
};

export const REGIONAL_SPECS:RegionalSpec[]=[
 {key:"fuel",label:"АЗС",aliases:["азс","заправка","заправки","автозаправка","автозаправки","fuel","gas station","gas stations","petrol station","petrol stations"],osm:"(tags->>'amenity'='fuel' OR tags->>'shop'='fuel')",overture:["gas station","gas_station","fuel","petrol station","petrol_station","service station","service_station"],overtureTypes:["place"]},
 {key:"hospital",label:"Больницы и клиники",aliases:["больница","больницы","лікарня","лікарні","hospital","hospitals","clinic","clinics"],osm:"(tags->>'amenity' IN ('hospital','clinic') OR tags->>'healthcare' IN ('hospital','clinic'))",overture:["hospital","clinic","medical center","medical_center"],overtureTypes:["place"]},
 {key:"pharmacy",label:"Аптеки",aliases:["аптека","аптеки","pharmacy","pharmacies"],osm:"(tags->>'amenity'='pharmacy' OR tags->>'healthcare'='pharmacy')",overture:["pharmacy","drugstore"],overtureTypes:["place"]},
 {key:"school",label:"Учебные заведения",aliases:["учебные заведения","навчальні заклади","школа","школы","школи","school","schools","education"],osm:"(tags->>'amenity' IN ('school','university','college','kindergarten') OR tags->>'building' IN ('school','university','college','kindergarten'))",overture:["school","university","college","kindergarten"],overtureTypes:["place"]},
 {key:"fire_station",label:"Пожарные части",aliases:["пожарная часть","пожарные части","пожежна частина","пожежні частини","fire station","fire stations"],osm:"(tags->>'amenity'='fire_station' OR tags->>'emergency'='fire_station')",overture:["fire station","fire_station"],overtureTypes:["place"]},
 {key:"police",label:"Полиция",aliases:["полиция","поліція","police"],osm:"(tags->>'amenity'='police' OR tags->>'office'='police')",overture:["police","police station","police_station"],overtureTypes:["place"]},
 {key:"power_substation",label:"Электроподстанции",aliases:["подстанция","подстанции","электроподстанция","электроподстанции","трансформаторная подстанция","трансформаторные подстанции","підстанція","підстанції","електропідстанція","електропідстанції","трансформаторна підстанція","пс","substation","substations","power substation","power substations","electrical substation","electrical substations","transformer substation"],osm:"(tags->>'power'='substation')",overture:["substation","power substation","power_substation"],overtureTypes:["infrastructure","place"]},
 {key:"power_plant",label:"Электростанции",aliases:["электростанция","электростанции","електростанція","електростанції","power plant","power plants","power station","power stations","тэс","тэц","гэс","аэс","tes","chp","hydroelectric power station","nuclear power station"],osm:"(tags->>'power'='plant' OR tags->>'power'='generator' OR tags->>'plant:source' IS NOT NULL)",overture:["power plant","power_plant","power station","power_station","generator"],overtureTypes:["infrastructure","place"]},
 {key:"reservoir",label:"Резервуары и ёмкости",aliases:["резервуар","резервуары","резервуари","емкость","емкости","ёмкость","ёмкости","ємність","ємності","storage tank","storage tanks","tank","tanks","reservoir","reservoirs"],osm:"(tags->>'man_made'='storage_tank' OR tags->>'building'='storage_tank' OR tags->>'water'='reservoir' OR tags->>'landuse'='reservoir')",overture:["storage tank","storage_tank","tank","reservoir"],overtureTypes:["infrastructure","place"]},
 {key:"energy",label:"Энергообъекты",aliases:["энергетика","энергообъекты","энергообъект","енергетика","енергооб'єкти","energy","power"],osm:"(tags ? 'power')",overture:["power","substation","power plant","power_plant","electric"],overtureTypes:["infrastructure","place"]},
 {key:"industrial",label:"Промышленные объекты",aliases:["промышленность","промышленные","промышленные объекты","промисловість","промислові об'єкти","industrial","factory","factories"],osm:"(tags->>'landuse'='industrial' OR tags->>'man_made'='works' OR tags ? 'industrial' OR tags->>'building' IN ('industrial','factory'))",overture:["industrial","factory","manufacturing","plant"],overtureTypes:["place","infrastructure"]},
 {key:"warehouse",label:"Склады",aliases:["склад","склады","склади","warehouse","warehouses"],osm:"(tags->>'building'='warehouse' OR tags->>'industrial'='warehouse')",overture:["warehouse","distribution center","distribution_center"],overtureTypes:["place"]},
 {key:"supermarket",label:"Супермаркеты",aliases:["супермаркет","супермаркеты","супермаркети","supermarket","supermarkets"],osm:"(tags->>'shop'='supermarket' OR tags->>'building'='supermarket')",overture:["supermarket","grocery"],overtureTypes:["place"]},
 {key:"telecom",label:"Телеком-инфраструктура",aliases:["телеком","вышки связи","вежі зв'язку","telecom","communications tower","communications towers"],osm:"(tags ? 'telecom' OR tags->>'office'='telecommunication' OR tags->>'tower:type'='communication' OR tags->>'man_made' IN ('mast','communications_tower','antenna'))",overture:["telecom","communication","communications tower","communications_tower"],overtureTypes:["infrastructure","place"]},
 {key:"transport",label:"Транспортные узлы",aliases:["транспорт","транспортные узлы","транспортні вузли","transport","станции","станції"],osm:"(tags->>'railway' IN ('station','halt','yard','terminal') OR tags->>'amenity'='bus_station' OR tags->>'aeroway' IN ('aerodrome','terminal') OR tags->>'harbour'='yes' OR tags->>'seamark:type'='harbour')",overture:["station","terminal","airport","harbour","harbor","transport"],overtureTypes:["place","infrastructure"]}
];

export const GENERIC_OSM_HINTS=[
 {key:"oil_depot",label:"Нефтебазы / топливные базы",aliases:["нефтебаза","нефтебазы","нафтобаза","нафтобази","oil depot","oil depots","fuel depot","fuel depots"],osm:"(lower(coalesce(tags->>'name','')) LIKE '%нефтебаз%' OR lower(coalesce(tags->>'name:ru','')) LIKE '%нефтебаз%' OR lower(coalesce(tags->>'name:uk','')) LIKE '%нафтобаз%' OR lower(coalesce(tags->>'name:en','')) LIKE '%oil depot%' OR ((tags->>'man_made'='storage_tank' OR tags->>'building'='storage_tank') AND tags->>'substance' IN ('oil','petroleum','fuel','diesel','gasoline')) OR (tags->>'industrial' IN ('oil','petroleum','fuel') AND (tags->>'man_made'='storage_tank' OR tags->>'building'='storage_tank')))"},
 {key:"power_transformer",label:"Трансформаторы",aliases:["трансформатор","трансформаторы","трансформатор силовой","електричний трансформатор","transformer","power transformer"],osm:"(tags->>'power'='transformer')"},
 {key:"grain_elevator",label:"Элеваторы / зернохранилища",aliases:["элеватор","элеваторы","елеватор","елеватори","зернохранилище","зерносховище","grain elevator","grain elevators","grain storage"],osm:"(tags->>'man_made'='silo' OR tags->>'building'='silo' OR tags->>'industrial' IN ('grain_storage','silo'))"},
 {key:"water_tower",label:"Водонапорные башни",aliases:["водонапорная башня","водонапорные башни","водонапірна вежа","водонапірні вежі","water tower","water towers"],osm:"(tags->>'man_made'='water_tower')"},
 {key:"quarry",label:"Карьеры",aliases:["карьер","карьеры","кар'єр","кар'єри","quarry","quarries"],osm:"(tags->>'landuse'='quarry')"},
 {key:"pumping_station",label:"Насосные станции",aliases:["насосная станция","насосные станции","насосна станція","насосні станції","pumping station","pumping stations"],osm:"(tags->>'man_made'='pumping_station' OR tags ? 'pumping_station')"},
 {key:"wastewater",label:"Очистные сооружения",aliases:["очистные сооружения","очистные","очисні споруди","канализационные очистные","wastewater plant","wastewater treatment plant","sewage treatment plant"],osm:"(tags->>'man_made'='wastewater_plant' OR tags->>'amenity'='wastewater_plant')"},
 {key:"landfill",label:"Полигоны отходов / свалки",aliases:["свалка","свалки","полигон отходов","полигон тбо","сміттєзвалище","полігон відходів","landfill","landfills"],osm:"(tags->>'landuse'='landfill')"},
 {key:"aerodrome",label:"Аэродромы",aliases:["аэродром","аэродромы","аеродром","аеродроми","aerodrome","aerodromes"],osm:"(tags->>'aeroway'='aerodrome')"},
 {key:"harbour",label:"Порты / гавани",aliases:["порт","порты","морской порт","речной порт","морський порт","harbour","harbor","port"],osm:"(tags->>'harbour'='yes' OR tags->>'seamark:type'='harbour' OR tags->>'industrial'='port')"},
 {key:"bridge",label:"Мосты",aliases:["мост","мосты","міст","мости","bridge","bridges"],osm:"(tags ? 'bridge' AND tags->>'bridge'<>'no')"},
 {key:"dam",label:"Дамбы / плотины",aliases:["дамба","дамбы","плотина","плотины","гребля","греблі","dam","dams","dyke","dike"],osm:"(tags->>'waterway'='dam' OR tags->>'man_made' IN ('dyke','embankment'))"},
 {key:"pipeline",label:"Трубопроводы",aliases:["трубопровод","трубопроводы","трубопровід","трубопроводи","pipeline","pipelines"],osm:"(tags->>'man_made'='pipeline' OR tags ? 'pipeline')"},
 {key:"petroleum_well",label:"Нефтегазовые скважины",aliases:["нефтяная скважина","газовая скважина","нефтегазовая скважина","свердловина","нафтова свердловина","газова свердловина","petroleum well","oil well","gas well"],osm:"(tags->>'man_made' IN ('petroleum_well','well') OR tags->>'industrial' IN ('oil_well','gas_well'))"}
] as const;

const SPEC_BY_KEY=new Map(REGIONAL_SPECS.map(s=>[norm(s.key),s]));
const ALIAS_INDEX=[...REGIONAL_SPECS.flatMap(s=>[s.key,s.label,...s.aliases].map(a=>({alias:norm(a),spec:s})))].sort((a,b)=>b.alias.length-a.alias.length);
const HINT_INDEX=[...GENERIC_OSM_HINTS.flatMap(h=>h.aliases.map(a=>({alias:norm(a),hint:h})))].sort((a,b)=>b.alias.length-a.alias.length);
const STOPWORDS=new Set(["все","вся","всех","all","найти","найди","покажи","показать","объекты","объект","обєкти","обекти","objects","object","по","в"]);
const AMBIGUOUS=new Map<string,{key:string;label:string}[]>([
 ["станция",[{key:"power_substation",label:"Электроподстанции"},{key:"power_plant",label:"Электростанции"},{key:"transport",label:"Транспортные узлы"},{key:"fuel",label:"АЗС"}]],
 ["station",[{key:"power_substation",label:"Power substations"},{key:"power_plant",label:"Power plants"},{key:"transport",label:"Transport hubs"},{key:"fuel",label:"Fuel stations"}]]
]);
const TEXT_TAG_KEYS=["name","name:uk","name:ru","name:en","brand","operator","description","ref","amenity","shop","office","industrial","man_made","power","building","landuse","water","waterway","railway","aeroway","craft","tourism","leisure","emergency","telecom","pipeline","substance","storage","utility","generator:source","plant:source","pumping_station"];

export function specFor(v:unknown){
 const q=norm(v);if(!q)return null;
 const direct=SPEC_BY_KEY.get(q);if(direct)return direct;
 return ALIAS_INDEX.find(x=>x.alias===q)?.spec??null;
}

export function parseRegionalQuery(v:unknown){
 const q=norm(v);if(!q)return null;
 for(const x of ALIAS_INDEX){
  if(!x.alias||q===x.alias)continue;
  if(q.endsWith(" "+x.alias)){const oblast=q.slice(0,-x.alias.length).trim();if(oblast)return{oblast,category:x.spec.key,spec:x.spec}}
  if(q.startsWith(x.alias+" ")){const oblast=q.slice(x.alias.length).trim();if(oblast)return{oblast,category:x.spec.key,spec:x.spec}}
 }
 return null;
}

function containsAlias(q:string,a:string){return q===a||q.startsWith(a+" ")||q.endsWith(" "+a)||q.includes(" "+a+" ")}
function removeAlias(q:string,a:string){
 if(q===a)return"";
 if(q.startsWith(a+" "))return q.slice(a.length).trim();
 if(q.endsWith(" "+a))return q.slice(0,-a.length).trim();
 const needle=" "+a+" ",i=q.indexOf(needle);
 return i>=0?(q.slice(0,i)+" "+q.slice(i+needle.length)).replace(/\s+/g," ").trim():q;
}
function cleanQualifier(v:string){return v.split(" ").filter(x=>x&&!STOPWORDS.has(x)).join(" ").trim()}
export function stableHash(v:string){let h=2166136261;for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")}
function sqlLike(v:string){return "'%"+v.replace(/'/g,"''")+"%'"}
function tokenPredicate(v:string){
 const t=norm(v).slice(0,80);if(!t)return"false";
 return"("+TEXT_TAG_KEYS.map(k=>"lower(coalesce(tags->>'"+k+"','')) LIKE "+sqlLike(t)).join(" OR ")+")";
}
export function buildSafeGenericPredicate(v:unknown){
 const q=norm(v).slice(0,80),tokens=[...new Set(q.split(" ").filter(x=>x.length>=2&&!STOPWORDS.has(x)))].slice(0,6);
 if(!q||tokens.length===0)return null;
 const phrase=tokenPredicate(q),all=tokens.map(tokenPredicate).join(" AND ");
 return tokens.length===1?phrase:"("+phrase+" OR ("+all+"))";
}
function qualifiedSpec(base:RegionalSpec,qualifier:string){
 const q=cleanQualifier(norm(qualifier));if(!q)return base;
 let rest=q,preds:string[]=[];
 const vm=rest.match(/(^|\s)(\d{1,4})\s*(кв|kv)(?=\s|$)/u);
 if(vm){const volts=String(Number(vm[2])*1000);preds.push("(coalesce(tags->>'voltage','') LIKE '%"+volts+"%')");rest=cleanQualifier(rest.replace(vm[0]," "))}
 if(rest){const p=buildSafeGenericPredicate(rest);if(p)preds.push(p)}
 if(!preds.length)return base;
 return{...base,key:base.key+"__q_"+stableHash(q),osm:"("+base.osm+") AND "+preds.map(x=>"("+x+")").join(" AND ")};
}

export function resolveCategoryIntent(v:unknown):CategoryResolution{
 const input=String(v??"").trim(),q=norm(input).slice(0,120);
 if(!q)return{mode:"ambiguous",input,normalized:q,confidence:0,suggestions:[]};
 const amb=AMBIGUOUS.get(q);if(amb)return{mode:"ambiguous",input,normalized:q,confidence:0,suggestions:amb};
 const exact=specFor(q);if(exact)return{mode:"canonical",input,normalized:q,confidence:1,matched_alias:q,qualifier:null,spec:exact};

 const known=ALIAS_INDEX.filter(x=>containsAlias(q,x.alias));
 if(known.length){
  const max=known[0].alias.length,top=known.filter(x=>x.alias.length===max),keys=[...new Set(top.map(x=>x.spec.key))];
  if(keys.length>1)return{mode:"ambiguous",input,normalized:q,confidence:0,suggestions:keys.map(k=>{const s=REGIONAL_SPECS.find(x=>x.key===k)!;return{key:s.key,label:s.label}})};
  const hit=top[0],qualifier=cleanQualifier(removeAlias(q,hit.alias)),spec=qualifiedSpec(hit.spec,qualifier);
  return{mode:qualifier?"qualified":"canonical",input,normalized:q,confidence:.98,matched_alias:hit.alias,qualifier:qualifier||null,spec};
 }

 const hintHits=HINT_INDEX.filter(x=>containsAlias(q,x.alias));
 if(hintHits.length){
  const hit=hintHits[0],qualifier=cleanQualifier(removeAlias(q,hit.alias));
  let osm=hit.hint.osm;if(qualifier){const p=buildSafeGenericPredicate(qualifier);if(p)osm="("+osm+") AND ("+p+")"}
  const spec:RegionalSpec={key:"hint_"+hit.hint.key+(qualifier?"__q_"+stableHash(qualifier):""),label:hit.hint.label,aliases:[...hit.hint.aliases],osm,overture:[],overtureTypes:[]};
  return{mode:"semantic_hint",input,normalized:q,confidence:.96,matched_alias:hit.alias,qualifier:qualifier||null,spec};
 }

 let best:{alias:string;spec:RegionalSpec;score:number}|null=null,second=0;
 for(const x of ALIAS_INDEX){const score=diceSimilarity(q,x.alias);if(!best||score>best.score){second=best?.score??0;best={...x,score}}else if(score>second)second=score}
 if(best&&best.score>=.86&&best.score-second>=.08)return{mode:"fuzzy",input,normalized:q,confidence:best.score,matched_alias:best.alias,qualifier:null,spec:best.spec};

 const generic=buildSafeGenericPredicate(q);
 if(!generic||q.length<2)return{mode:"ambiguous",input,normalized:q,confidence:0,suggestions:[]};
 const spec:RegionalSpec={key:"generic_"+stableHash(q),label:input.slice(0,80)||q,aliases:[q],osm:generic,overture:[],overtureTypes:[]};
 return{mode:"generic",input,normalized:q,confidence:.55,matched_alias:null,qualifier:null,spec};
}

export function validateRegionalCategories(){
 const owner=new Map<string,Set<string>>();
 for(const s of REGIONAL_SPECS)for(const a of [s.key,s.label,...s.aliases]){const q=norm(a);if(!q)continue;let set=owner.get(q);if(!set){set=new Set();owner.set(q,set)}set.add(s.key)}
 const duplicate_aliases=[...owner.entries()].filter(([,keys])=>keys.size>1).map(([alias,keys])=>({alias,keys:[...keys].sort()}));
 const hintOwner=new Map<string,Set<string>>();
 for(const h of GENERIC_OSM_HINTS)for(const a of h.aliases){const q=norm(a);let set=hintOwner.get(q);if(!set){set=new Set();hintOwner.set(q,set)}set.add(h.key)}
 const duplicate_hint_aliases=[...hintOwner.entries()].filter(([,keys])=>keys.size>1).map(([alias,keys])=>({alias,keys:[...keys].sort()}));
 return{ok:duplicate_aliases.length===0&&duplicate_hint_aliases.length===0,category_count:REGIONAL_SPECS.length,alias_count:owner.size,generic_hint_count:GENERIC_OSM_HINTS.length,generic_hint_alias_count:hintOwner.size,duplicate_aliases,duplicate_hint_aliases};
}


export type RegionalFilters={
 settlement?:string|null;
 address?:string|null;
 brand?:string|null;
 operator?:string|null;
};

const FILTER_ALIASES:Record<string,keyof RegionalFilters>={
 "city":"settlement","town":"settlement","settlement":"settlement","город":"settlement","місто":"settlement","населенный":"settlement","населений":"settlement",
 "addr":"address","address":"address","адрес":"address","адреса":"address",
 "brand":"brand","бренд":"brand",
 "operator":"operator","оператор":"operator"
};

function safeFilterValue(v:unknown){return String(v??"").trim().replace(/^["']|["']$/g,"").slice(0,120)}
function sqlText(v:string){return"'%"+String(v).toLowerCase().trim().replace(/'/g,"''")+"%'"}

export function normalizeFilters(v:any):RegionalFilters{
 const out:RegionalFilters={};
 if(!v||typeof v!=="object")return out;
 for(const k of ["settlement","address","brand","operator"] as const){
  const x=safeFilterValue(v[k]);if(x)out[k]=x;
 }
 return out;
}

export function extractRegionalFilters(v:unknown){
 let text=String(v??"").trim();
 const filters:RegionalFilters={};
 const re=/(^|\s)(city|town|settlement|город|місто|населенный|населений|addr|address|адрес|адреса|brand|бренд|operator|оператор)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s+]+)/giu;
 text=text.replace(re,(m,prefix,key,value)=>{
  const mapped=FILTER_ALIASES[norm(key)],clean=safeFilterValue(value);
  if(mapped&&clean)filters[mapped]=clean;
  return prefix?" ":"";
 }).replace(/\s+/g," ").replace(/\s*\+\s*/g," + ").trim();
 return{text,filters};
}

export function mergeFilters(a:RegionalFilters,b:RegionalFilters){
 const out:RegionalFilters={...a};
 for(const k of ["settlement","address","brand","operator"] as const)if(b[k])out[k]=b[k];
 return out;
}

export function buildFilterPredicate(filters:RegionalFilters){
 const f=normalizeFilters(filters),preds:string[]=[];
 if(f.settlement){
  const q=sqlText(f.settlement);
  preds.push("(lower(coalesce(tags->>'addr:city','')) LIKE "+q+" OR lower(coalesce(tags->>'addr:town','')) LIKE "+q+" OR lower(coalesce(tags->>'addr:village','')) LIKE "+q+" OR lower(coalesce(tags->>'addr:place','')) LIKE "+q+" OR lower(coalesce(tags->>'is_in','')) LIKE "+q+")");
 }
 if(f.address){
  const q=sqlText(f.address);
  preds.push("(lower(concat_ws(' ',coalesce(tags->>'addr:full',''),coalesce(tags->>'addr:street',''),coalesce(tags->>'addr:housenumber',''),coalesce(tags->>'addr:place',''))) LIKE "+q+")");
 }
 if(f.brand){
  const q=sqlText(f.brand);
  preds.push("(lower(coalesce(tags->>'brand','')) LIKE "+q+" OR lower(coalesce(tags->>'brand:uk','')) LIKE "+q+" OR lower(coalesce(tags->>'brand:ru','')) LIKE "+q+" OR lower(coalesce(tags->>'name','')) LIKE "+q+")");
 }
 if(f.operator){
  const q=sqlText(f.operator);
  preds.push("(lower(coalesce(tags->>'operator','')) LIKE "+q+" OR lower(coalesce(tags->>'operator:uk','')) LIKE "+q+" OR lower(coalesce(tags->>'operator:ru','')) LIKE "+q+")");
 }
 return preds.length?preds.map(x=>"("+x+")").join(" AND "):"true";
}

export function splitObjectExpression(v:unknown){
 return String(v??"").split(/\s*\+\s*/u).map(x=>x.trim()).filter(Boolean).slice(0,6);
}

export function resolveCategoryList(inputs:unknown[]){
 const resolutions=inputs.map(resolveCategoryIntent);
 const ambiguous=resolutions.find(x=>x.mode==="ambiguous"||!x.spec);
 const unique:CategoryResolution[]=[];
 const seen=new Set<string>();
 for(const r of resolutions){
  const k=r.spec?.key;if(!k||seen.has(k))continue;seen.add(k);unique.push(r);
 }
 return{resolutions:unique,ambiguous};
}

export function multiKey(resolutions:CategoryResolution[],filters:RegionalFilters){
 const keys=resolutions.map(x=>x.spec?.key??"").filter(Boolean).sort();
 const f=normalizeFilters(filters);
 return stableHash(JSON.stringify({keys,f}));
}
