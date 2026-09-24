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

export function expandedAliases(d:OblastDefinition){
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

export function diceSimilarity(a:unknown,b:unknown){
 const x=normalizeRegionQuery(a),y=normalizeRegionQuery(b);
 if(!x||!y)return 0;if(x===y)return 1;if(x.includes(y)||y.includes(x))return .94;
 const bg=(s:string)=>{const m=new Map<string,number>();for(let i=0;i<s.length-1;i++){const q=s.slice(i,i+2);m.set(q,(m.get(q)??0)+1)}return m};
 const A=bg(x),B=bg(y);let hit=0,na=0,nb=0;
 for(const v of A.values())na+=v;for(const v of B.values())nb+=v;
 for(const [k,v] of A)hit+=Math.min(v,B.get(k)??0);
 return na+nb?2*hit/(na+nb):0;
}

function definitionMap(){return new Map(OBLAST_DEFINITIONS.map(d=>[d.code,d]))}

export function resolveOblastRow<T extends OblastRow>(rows:T[],query:unknown):(T&{score:number})|null{
 const raw=String(query??"").trim(),q=normalizeRegionQuery(raw);if(!q)return null;
 const defs=definitionMap();
 const byCode=rows.filter(r=>String(r.code).toLowerCase()===raw.toLowerCase());
 if(byCode.length===1)return{...byCode[0],score:1};
 const exact:T[]=[];
 for(const row of rows){
  const d=defs.get(String(row.code));
  const aliases=unique([String(row.name_uk??""),String(row.name_en??""),...(d?expandedAliases(d):[])]);
  if(aliases.includes(q))exact.push(row);
 }
 if(exact.length===1)return{...exact[0],score:1};
 if(exact.length>1)return null;
 const scored=rows.map(row=>{
  const d=defs.get(String(row.code));
  const aliases=unique([String(row.name_uk??""),String(row.name_en??""),...(d?expandedAliases(d):[])]);
  const score=aliases.reduce((m,a)=>Math.max(m,diceSimilarity(q,a)),0);
  return{row,score};
 }).sort((a,b)=>b.score-a.score);
 const best=scored[0],second=scored[1];
 if(!best||best.score<.60)return null;
 if(second&&best.score-second.score<.08)return null;
 return{...best.row,score:best.score};
}

export function validateOblastAliases(rows:OblastRow[]){
 const defs=definitionMap(),dbCodes=[...new Set(rows.map(r=>String(r.code)))].sort(),aliasCodes=[...defs.keys()].sort();
 const missing_in_alias_map=dbCodes.filter(x=>!defs.has(x));
 const unknown_alias_codes=aliasCodes.filter(x=>!dbCodes.includes(x));
 const owner=new Map<string,Set<string>>();
 for(const d of OBLAST_DEFINITIONS)for(const a of expandedAliases(d)){if(!owner.has(a))owner.set(a,new Set());owner.get(a)!.add(d.code)}
 const duplicate_aliases=[...owner.entries()].filter(([,codes])=>codes.size>1).map(([alias,codes])=>({alias,codes:[...codes].sort()}));
 const failed_resolution:{query:string;expected:string;actual:string|null}[]=[];
 for(const d of OBLAST_DEFINITIONS){
  for(const alias of expandedAliases(d)){
   const got=resolveOblastRow(rows,alias)?.code??null;
   if(got!==d.code)failed_resolution.push({query:alias,expected:d.code,actual:got});
  }
 }
 return{
  ok:missing_in_alias_map.length===0&&unknown_alias_codes.length===0&&duplicate_aliases.length===0&&failed_resolution.length===0,
  db_region_count:dbCodes.length,
  alias_region_count:aliasCodes.length,
  alias_variant_count:[...owner.keys()].length,
  missing_in_alias_map,unknown_alias_codes,duplicate_aliases,failed_resolution
 };
}
