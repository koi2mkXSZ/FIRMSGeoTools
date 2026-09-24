import {OBLAST_DEFINITIONS,expandedAliases,normalizeRegionQuery,resolveOblastRow,validateOblastAliases} from "./region_aliases.ts";

function assert(x:unknown,msg:string){if(!x)throw new Error(msg)}
const rows=OBLAST_DEFINITIONS.map((d,i)=>({id:i+1,code:d.code,name_uk:d.uk,name_en:d.en}));

Deno.test("regional aliases cover exactly 27 database jurisdictions",()=>{
 assert(OBLAST_DEFINITIONS.length===27,"expected 27 region definitions");
 assert(new Set(OBLAST_DEFINITIONS.map(x=>x.code)).size===27,"duplicate region code");
});

Deno.test("all declared and generated aliases resolve without collisions",()=>{
 const r=validateOblastAliases(rows);
 assert(r.ok,"alias validation failed: "+JSON.stringify(r));
 assert(r.alias_variant_count>300,"expected broad alias coverage");
});

Deno.test("RU UK EN primary names resolve for every region",()=>{
 for(const d of OBLAST_DEFINITIONS){
  for(const q of [d.ru,d.uk,d.en]){
   const got=resolveOblastRow(rows,q);
   assert(got?.code===d.code,`${q} -> ${got?.code??"null"}, expected ${d.code}`);
  }
 }
});

Deno.test("Kyiv city and Kyiv oblast remain unambiguous",()=>{
 const cases:[string,string][]=[
  ["Киевская область","UA32"],["Київська область","UA32"],["Киевская обл.","UA32"],
  ["Kyiv region","UA32"],["Kiev oblast","UA32"],["Київщина","UA32"],
  ["Киев","UA80"],["Київ","UA80"],["Kyiv","UA80"],["Kiev","UA80"]
 ];
 for(const [q,code] of cases)assert(resolveOblastRow(rows,q)?.code===code,`${q} must resolve to ${code}`);
});

Deno.test("normalization is punctuation and case tolerant",()=>{
 assert(normalizeRegionQuery("  ІВАНО-ФРАНКІВСЬКА   ОБЛ. ")==="івано франківська обл","normalization mismatch");
 assert(resolveOblastRow(rows,"ІВАНО-ФРАНКІВСЬКА ОБЛ.")?.code==="UA26","hyphenated oblast failed");
});

Deno.test("common Russian legacy spellings resolve",()=>{
 const cases:[string,string][]=[
  ["Днепропетровская область","UA12"],["Запорожская область","UA23"],["Ровенская область","UA56"],
  ["Николаевская область","UA48"],["Одесская область","UA51"],["Харьковская область","UA63"],
  ["Черновицкая область","UA73"],["Черниговская область","UA74"],["Волынская область","UA07"]
 ];
 for(const [q,code] of cases)assert(resolveOblastRow(rows,q)?.code===code,`${q} must resolve to ${code}`);
});

Deno.test("every non-city region accepts oblast/region suffixes",()=>{
 for(const d of OBLAST_DEFINITIONS.filter(x=>x.kind!=="city")){
  const qs=[d.ru+" область",d.uk+" область",d.en+" region",d.en+" oblast"];
  for(const q of qs)assert(resolveOblastRow(rows,q)?.code===d.code,`${q} must resolve to ${d.code}`);
 }
});
