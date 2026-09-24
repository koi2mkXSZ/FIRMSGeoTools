import { normalizeRegionQuery as norm } from "./region_aliases.ts";

export type RegionalSpec={
  key:string;
  label:string;
  aliases:string[];
  osm:string;
  overture:string[];
  overtureTypes:string[];
};

export const REGIONAL_SPECS:RegionalSpec[]=[
 {key:"fuel",label:"АЗС",aliases:["азс","заправка","заправки","автозаправка","автозаправки","fuel","gas station","gas stations","petrol station","petrol stations"],osm:"(tags->>'amenity'='fuel' OR tags->>'shop'='fuel')",overture:["gas station","gas_station","fuel","petrol station","petrol_station","service station","service_station"],overtureTypes:["place"]},
 {key:"hospital",label:"Больницы и клиники",aliases:["больница","больницы","лікарня","лікарні","hospital","hospitals","clinic","clinics"],osm:"(tags->>'amenity' IN ('hospital','clinic') OR tags->>'healthcare' IN ('hospital','clinic'))",overture:["hospital","clinic","medical center","medical_center"],overtureTypes:["place"]},
 {key:"pharmacy",label:"Аптеки",aliases:["аптека","аптеки","pharmacy","pharmacies"],osm:"(tags->>'amenity'='pharmacy' OR tags->>'healthcare'='pharmacy')",overture:["pharmacy","drugstore"],overtureTypes:["place"]},
 {key:"school",label:"Учебные заведения",aliases:["учебные заведения","навчальні заклади","школа","школы","школи","school","schools","education"],osm:"(tags->>'amenity' IN ('school','university','college','kindergarten') OR tags->>'building' IN ('school','university','college','kindergarten'))",overture:["school","university","college","kindergarten"],overtureTypes:["place"]},
 {key:"fire_station",label:"Пожарные части",aliases:["пожарная часть","пожарные части","пожежна частина","пожежні частини","fire station","fire stations"],osm:"(tags->>'amenity'='fire_station' OR tags->>'emergency'='fire_station')",overture:["fire station","fire_station"],overtureTypes:["place"]},
 {key:"police",label:"Полиция",aliases:["полиция","поліція","police"],osm:"(tags->>'amenity'='police' OR tags->>'office'='police')",overture:["police","police station","police_station"],overtureTypes:["place"]},
 {key:"power_substation",label:"Электроподстанции",aliases:["подстанция","подстанции","электроподстанция","электроподстанции","підстанція","підстанції","електропідстанція","електропідстанції","пс","substation","substations","power substation","power substations","electrical substation","electrical substations"],osm:"(tags->>'power'='substation')",overture:["substation","power substation","power_substation"],overtureTypes:["infrastructure","place"]},
 {key:"power_plant",label:"Электростанции",aliases:["электростанция","электростанции","електростанція","електростанції","power plant","power plants","power station","power stations","тэс","тэц","гэс","аэс","tes","chp","hydroelectric power station","nuclear power station"],osm:"(tags->>'power'='plant' OR tags->>'power'='generator' OR tags->>'plant:source' IS NOT NULL)",overture:["power plant","power_plant","power station","power_station","generator"],overtureTypes:["infrastructure","place"]},
 {key:"reservoir",label:"Резервуары и ёмкости",aliases:["резервуар","резервуары","резервуари","емкость","емкости","ёмкость","ёмкости","ємність","ємності","storage tank","storage tanks","tank","tanks","reservoir","reservoirs"],osm:"(tags->>'man_made'='storage_tank' OR tags->>'building'='storage_tank' OR tags->>'water'='reservoir' OR tags->>'landuse'='reservoir')",overture:["storage tank","storage_tank","tank","reservoir"],overtureTypes:["infrastructure","place"]},
 {key:"energy",label:"Энергообъекты",aliases:["энергетика","энергообъекты","энергообъект","енергетика","енергооб'єкти","energy","power"],osm:"(tags ? 'power')",overture:["power","substation","power plant","power_plant","electric"],overtureTypes:["infrastructure","place"]},
 {key:"industrial",label:"Промышленные объекты",aliases:["промышленность","промышленные","промышленные объекты","промисловість","промислові об'єкти","industrial","factory","factories"],osm:"(tags->>'landuse'='industrial' OR tags->>'man_made'='works' OR tags ? 'industrial' OR tags->>'building' IN ('industrial','factory'))",overture:["industrial","factory","manufacturing","plant"],overtureTypes:["place","infrastructure"]},
 {key:"warehouse",label:"Склады",aliases:["склад","склады","склади","warehouse","warehouses"],osm:"(tags->>'building'='warehouse' OR tags->>'industrial'='warehouse')",overture:["warehouse","distribution center","distribution_center"],overtureTypes:["place"]},
 {key:"supermarket",label:"Супермаркеты",aliases:["супермаркет","супермаркеты","супермаркети","supermarket","supermarkets"],osm:"(tags->>'shop'='supermarket' OR tags->>'building'='supermarket')",overture:["supermarket","grocery"],overtureTypes:["place"]},
 {key:"telecom",label:"Телеком-инфраструктура",aliases:["телеком","вышки связи","вежі зв'язку","telecom","communications tower","communications towers"],osm:"(tags ? 'telecom' OR tags->>'office'='telecommunication' OR tags->>'tower:type'='communication' OR tags->>'man_made' IN ('mast','communications_tower','antenna'))",overture:["telecom","communication","communications tower","communications_tower"],overtureTypes:["infrastructure","place"]},
 {key:"transport",label:"Транспортные узлы",aliases:["транспорт","транспортные узлы","транспортні вузли","transport","станции","станції"],osm:"(tags->>'railway' IN ('station','halt','yard','terminal') OR tags->>'amenity'='bus_station' OR tags->>'aeroway' IN ('aerodrome','terminal') OR tags->>'harbour'='yes' OR tags->>'seamark:type'='harbour')",overture:["station","terminal","airport","harbour","harbor","transport"],overtureTypes:["place","infrastructure"]}
];

const SPEC_BY_KEY=new Map(REGIONAL_SPECS.map(s=>[norm(s.key),s]));
const ALIAS_INDEX=[...REGIONAL_SPECS.flatMap(s=>[s.key,s.label,...s.aliases].map(a=>({alias:norm(a),spec:s})))].sort((a,b)=>b.alias.length-a.alias.length);

export function specFor(v:unknown){
 const q=norm(v);if(!q)return null;
 const direct=SPEC_BY_KEY.get(q);if(direct)return direct;
 return ALIAS_INDEX.find(x=>x.alias===q)?.spec??null;
}

export function parseRegionalQuery(v:unknown){
 const q=norm(v);if(!q)return null;
 for(const x of ALIAS_INDEX){
  if(!x.alias)continue;
  if(q===x.alias)continue;
  if(q.endsWith(" "+x.alias)){
   const oblast=q.slice(0,-x.alias.length).trim();
   if(oblast)return{oblast,category:x.spec.key,spec:x.spec};
  }
  if(q.startsWith(x.alias+" ")){
   const oblast=q.slice(x.alias.length).trim();
   if(oblast)return{oblast,category:x.spec.key,spec:x.spec};
  }
 }
 return null;
}

export function validateRegionalCategories(){
 const owner=new Map<string,Set<string>>();
 for(const s of REGIONAL_SPECS){
  for(const a of [s.key,s.label,...s.aliases]){
   const q=norm(a);if(!q)continue;
   let set=owner.get(q);if(!set){set=new Set();owner.set(q,set)}set.add(s.key);
  }
 }
 const duplicate_aliases=[...owner.entries()].filter(([,keys])=>keys.size>1).map(([alias,keys])=>({alias,keys:[...keys].sort()}));
 return{ok:duplicate_aliases.length===0,category_count:REGIONAL_SPECS.length,alias_count:owner.size,duplicate_aliases};
}
