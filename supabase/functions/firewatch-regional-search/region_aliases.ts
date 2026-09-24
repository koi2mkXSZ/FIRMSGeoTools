export type OblastKind="oblast"|"city"|"autonomy";
export type OblastDefinition={code:string;uk:string;ru:string;en:string;kind:OblastKind;aliases:string[]};
export type OblastRow={id?:number;code:string;name_uk?:string|null;name_en?:string|null};

export const OBLAST_DEFINITIONS:OblastDefinition[]=[
 {code:"UA01",uk:"Автономна Республіка Крим",ru:"Автономная Республика Крым",en:"Autonomous Republic of Crimea",kind:"autonomy",aliases:["Крим","Крым","Республика Крым","Crimea"]},
 {code:"UA05",uk:"Вінницька",ru:"Винницкая",en:"Vinnytska",kind:"oblast",aliases:["Вінниця","Винница","Vinnytsia","Vinnitsa"]},
 {code:"UA07",uk:"Волинська",ru:"Волынская",en:"Volynska",kind:"oblast",aliases:["Волинь","Волынь","Volyn"]},
 {code:"UA12",uk:"Дніпропетровська",ru:"Днепропетровская",en:"Dnipropetrovska",kind:"oblast",aliases:["Дніпропетровщина","Днепропетровщина","Dnipro region","Dnipropetrovsk","Dnepropetrovsk"]},
 {code:"UA14",uk:"Донецька",ru:"Донецкая",en:"Donetska",kind:"oblast",aliases:["Донеччина","Донецк","Donetsk"]},
 {code:"UA18",uk:"Житомирська",ru:"Житомирская",en:"Zhytomyrska",kind:"oblast",aliases:["Житомир","Zhytomyr","Zhitomir"]},
 {code:"UA21",uk:"Закарпатська",ru:"Закарпатская",en:"Zakarpatska",kind:"oblast",aliases:["Закарпаття","Закарпатье","Zakarpattia","Transcarpathia"]},
 {code:"UA23",uk:"Запорізька",ru:"Запорожская",en:"Zaporizka",kind:"oblast",aliases:["Запоріжжя","Запорожье","Zaporizhzhia","Zaporozhye"]},
 {code:"UA26",uk:"Івано-Франківська",ru:"Ивано-Франковская",en:"Ivano-Frankivska",kind:"oblast",aliases:["Івано-Франківськ","Ивано-Франковск","Ivano-Frankivsk"]},
 {code:"UA32",uk:"Київська",ru:"Киевская",en:"Kyivska",kind:"oblast",aliases:["Київщина","Киевщина","Kyiv region","Kiev region","Kyiv oblast","Kiev oblast"]},
 {code:"UA35",uk:"Кіровоградська",ru:"Кировоградская",en:"Kirovohradska",kind:"oblast",aliases:["Кіровоградщина","Кировоградщина","Kirovohrad","Kirovograd"]},
 {code:"UA44",uk:"Луганська",ru:"Луганская",en:"Luhanska",kind:"oblast",aliases:["Луганщина","Луганск","Luhansk","Lugansk"]},
 {code:"UA46",uk:"Львівська",ru:"Львовская",en:"Lvivska",kind:"oblast",aliases:["Львів","Львов","Lviv","Lvov"]},
 {code:"UA48",uk:"Миколаївська",ru:"Николаевская",en:"Mykolaivska",kind:"oblast",aliases:["Миколаїв","Николаев","Mykolaiv","Nikolaev"]},
 {code:"UA51",uk:"Одеська",ru:"Одесская",en:"Odeska",kind:"oblast",aliases:["Одеса","Одесса","Odesa","Odessa"]},
 {code:"UA53",uk:"Полтавська",ru:"Полтавская",en:"Poltavska",kind:"oblast",aliases:["Полтава","Poltava"]},
 {code:"UA56",uk:"Рівненська",ru:"Ровенская",en:"Rivnenska",kind:"oblast",aliases:["Рівне","Ровно","Rivne","Rovno"]},
 {code:"UA59",uk:"Сумська",ru:"Сумская",en:"Sumska",kind:"oblast",aliases:["Суми","Сумы","Sumy"]},
 {code:"UA61",uk:"Тернопільська",ru:"Тернопольская",en:"Ternopilska",kind:"oblast",aliases:["Тернопіль","Тернополь","Ternopil"]},
 {code:"UA63",uk:"Харківська",ru:"Харьковская",en:"Kharkivska",kind:"oblast",aliases:["Харків","Харьков","Kharkiv","Kharkov"]},
 {code:"UA65",uk:"Херсонська",ru:"Херсонская",en:"Khersonska",kind:"oblast",aliases:["Херсон","Kherson"]},
 {code:"UA68",uk:"Хмельницька",ru:"Хмельницкая",en:"Khmelnytska",kind:"oblast",aliases:["Хмельницький","Хмельницкий","Khmelnytskyi","Khmelnitsky"]},
 {code:"UA71",uk:"Черкаська",ru:"Черкасская",en:"Cherkaska",kind:"oblast",aliases:["Черкаси","Черкассы","Cherkasy"]},
 {code:"UA73",uk:"Чернівецька",ru:"Черновицкая",en:"Chernivetska",kind:"oblast",aliases:["Чернівці","Черновцы","Chernivtsi","Chernovtsy"]},
 {code:"UA74",uk:"Чернігівська",ru:"Черниговская",en:"Chernihivska",kind:"oblast",aliases:["Чернігів","Чернигов","Chernihiv","Chernigov"]},
 {code:"UA80",uk:"Київ",ru:"Киев",en:"Kyiv",kind:"city",aliases:["Kiev"]},
 {code:"UA85",uk:"Севастополь",ru:"Севастополь",en:"Sevastopol",kind:"city",aliases:[]}
];

export function normalizeRegionQuery(v:unknown){
 return String(v??"").normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/['’\u02bc"]/g,"")
  .replace(/[^\p{L}\p{N}]+/gu," ")
  .replace(/\s+/g," ").trim();
}

function unique(xs:string[]){return[...new Set(xs.map(normalizeRegionQuery).filter(Boolean))]}
function expandDefinition(d:OblastDefinition){
 const base=unique([d.uk,d.ru,d.en,...d.aliases]);
 if(d.kind==="city")return base;
 const out=[...base];
 for(const a of base){
  if(!/(^| )(область|області|обл|region|oblast)( |$)/u.test(a)){
   out.push(a+" область",a+" області",a+" обл",a+" region",a+" oblast");
   out.push("область "+a,"області "+a,"region "+a,"oblast "+a);
  }
 }
 return unique(out);
}

const DEFINITION_BY_CODE=new Map(OBLAST_DEFINITIONS.map(d=>[d.code,d]));
const EXPANDED_BY_CODE=new Map(OBLAST_DEFINITIONS.map(d=>[d.code,expandDefinition(d)]));
const OWNER_BY_ALIAS=new Map<string,Set<string>>();
for(const d of OBLAST_DEFINITIONS){
 for(const a of EXPANDED_BY_CODE.get(d.code)??[]){
  let owners=OWNER_BY_ALIAS.get(a);if(!owners){owners=new Set();OWNER_BY_ALIAS.set(a,owners)}owners.add(d.code);
 }
}
const EXACT_CODE_BY_ALIAS=new Map<string,string|null>();
for(const [alias,owners] of OWNER_BY_ALIAS)EXACT_CODE_BY_ALIAS.set(alias,owners.size===1?[...owners][0]:null);

const REGION_SPLIT_INDEX=[
 ...[...EXACT_CODE_BY_ALIAS.entries()].filter((x):x is [string,string]=>typeof x[1]==="string").map(([alias,code])=>({alias,code})),
 ...OBLAST_DEFINITIONS.map(d=>({alias:normalizeRegionQuery(d.code),code:d.code}))
].filter((x,i,a)=>a.findIndex(y=>y.alias===x.alias&&y.code===x.code)===i)
 .sort((a,b)=>b.alias.length-a.alias.length);

export function splitRegionObjectQuery(v:unknown){
 const q=normalizeRegionQuery(v);if(!q)return null;
 for(const x of REGION_SPLIT_INDEX){
  if(q.startsWith(x.alias+" ")){
   const object_query=q.slice(x.alias.length).trim();
   if(object_query)return{oblast:x.alias,oblast_code:x.code,object_query,position:"prefix" as const};
  }
  if(q.endsWith(" "+x.alias)){
   const object_query=q.slice(0,-x.alias.length).trim();
   if(object_query)return{oblast:x.alias,oblast_code:x.code,object_query,position:"suffix" as const};
  }
 }
 return null;
}

export function expandedAliases(d:OblastDefinition){return[...(EXPANDED_BY_CODE.get(d.code)??expandDefinition(d))]}

export function diceSimilarity(a:unknown,b:unknown){
 const x=normalizeRegionQuery(a),y=normalizeRegionQuery(b);
 if(!x||!y)return 0;if(x===y)return 1;if(x.includes(y)||y.includes(x))return .94;
 const bg=(s:string)=>{const m=new Map<string,number>();for(let i=0;i<s.length-1;i++){const q=s.slice(i,i+2);m.set(q,(m.get(q)??0)+1)}return m};
 const A=bg(x),B=bg(y);let hit=0,na=0,nb=0;
 for(const v of A.values())na+=v;for(const v of B.values())nb+=v;
 for(const [k,v] of A)hit+=Math.min(v,B.get(k)??0);
 return na+nb?2*hit/(na+nb):0;
}

export function resolveOblastRow<T extends OblastRow>(rows:T[],query:unknown):(T&{score:number})|null{
 const raw=String(query??"").trim(),q=normalizeRegionQuery(raw);if(!q)return null;
 const byCode=rows.find(r=>String(r.code).toLowerCase()===raw.toLowerCase());
 if(byCode)return{...byCode,score:1};

 const exactCode=EXACT_CODE_BY_ALIAS.get(q);
 if(exactCode){
  const row=rows.find(r=>String(r.code)===exactCode);
  if(row)return{...row,score:1};
 }
 if(EXACT_CODE_BY_ALIAS.has(q)&&exactCode===null)return null;

 for(const row of rows){
  if(q===normalizeRegionQuery(row.name_uk)||q===normalizeRegionQuery(row.name_en))return{...row,score:1};
 }

 const scored=rows.map(row=>{
  const code=String(row.code),aliases=EXPANDED_BY_CODE.get(code)??[];
  let score=Math.max(diceSimilarity(q,row.name_uk),diceSimilarity(q,row.name_en));
  for(const a of aliases){const s=diceSimilarity(q,a);if(s>score)score=s;if(score===1)break}
  return{row,score};
 }).sort((a,b)=>b.score-a.score);
 const best=scored[0],second=scored[1];
 if(!best||best.score<.60)return null;
 if(second&&best.score-second.score<.08)return null;
 return{...best.row,score:best.score};
}

export function validateOblastAliases(rows:OblastRow[]){
 const dbCodes=[...new Set(rows.map(r=>String(r.code)))].sort(),aliasCodes=[...DEFINITION_BY_CODE.keys()].sort();
 const missing_in_alias_map=dbCodes.filter(x=>!DEFINITION_BY_CODE.has(x));
 const unknown_alias_codes=aliasCodes.filter(x=>!dbCodes.includes(x));
 const duplicate_aliases=[...OWNER_BY_ALIAS.entries()]
  .filter(([,codes])=>codes.size>1)
  .map(([alias,codes])=>({alias,codes:[...codes].sort()}));
 const failed_resolution:{query:string;expected:string;actual:string|null}[]=[];
 for(const d of OBLAST_DEFINITIONS){
  const rowExists=rows.some(r=>String(r.code)===d.code);
  if(!rowExists)continue;
  for(const alias of EXPANDED_BY_CODE.get(d.code)??[]){
   const actual=EXACT_CODE_BY_ALIAS.get(alias)??null;
   if(actual!==d.code)failed_resolution.push({query:alias,expected:d.code,actual});
  }
 }
 const split_failures:{query:string;expected:string;actual:string|null}[]=[];
 for(const d of OBLAST_DEFINITIONS){
  for(const alias of EXPANDED_BY_CODE.get(d.code)??[]){
   for(const q of [alias+" __generic_probe__","__generic_probe__ "+alias]){
    const got=splitRegionObjectQuery(q)?.oblast_code??null;
    if(got!==d.code)split_failures.push({query:q,expected:d.code,actual:got});
   }
  }
 }
 return{
  ok:missing_in_alias_map.length===0&&unknown_alias_codes.length===0&&duplicate_aliases.length===0&&failed_resolution.length===0&&split_failures.length===0,
  db_region_count:dbCodes.length,
  alias_region_count:aliasCodes.length,
  alias_variant_count:OWNER_BY_ALIAS.size,
  missing_in_alias_map,unknown_alias_codes,duplicate_aliases,failed_resolution,split_failures
 };
}
