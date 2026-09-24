import {buildSafeGenericPredicate,parseRegionalQuery,resolveCategoryIntent,specFor,validateRegionalCategories} from "./regional_categories.ts";
import {normalizeRegionQuery} from "./region_aliases.ts";

function assert(x:unknown,msg:string){if(!x)throw new Error(msg)}

Deno.test("regional category aliases are unique",()=>{
 const r=validateRegionalCategories();
 assert(r.ok,"category alias collision: "+JSON.stringify(r));
 assert(r.category_count>=15,"expected expanded regional category catalog");
});

Deno.test("new infrastructure aliases resolve",()=>{
 const cases:[string,string][]=[
  ["Подстанция","power_substation"],["ПС","power_substation"],["підстанція","power_substation"],
  ["электростанция","power_plant"],["ТЭЦ","power_plant"],["АЭС","power_plant"],
  ["Резервуар","reservoir"],["ёмкости","reservoir"],["storage tank","reservoir"]
 ];
 for(const [q,key] of cases)assert(specFor(q)?.key===key,`${q} -> ${specFor(q)?.key??"null"}, expected ${key}`);
});

Deno.test("full Telegram-style queries are parsed centrally",()=>{
 const cases:[string,string,string][]=[
  ["Полтавская область Подстанция","полтавская область","power_substation"],
  ["Полтавская область ПС","полтавская область","power_substation"],
  ["Полтавская область Резервуар","полтавская область","reservoir"],
  ["Полтавская область электростанция","полтавская область","power_plant"],
  ["АЗС Киевская область","киевская область","fuel"],
  ["Київська область аптеки","київська область","pharmacy"]
 ];
 for(const [q,oblast,category] of cases){const p=parseRegionalQuery(q);assert(normalizeRegionQuery(p?.oblast)===normalizeRegionQuery(oblast)&&p?.category===category,`${q} -> ${JSON.stringify(p)}`)}
});


Deno.test("universal resolver handles semantic hints and arbitrary text",()=>{
 const hints:[string,string][]=[
  ["нефтебаза","semantic_hint"],["элеватор","semantic_hint"],["водонапорная башня","semantic_hint"],
  ["карьер","semantic_hint"],["насосная станция","semantic_hint"],["трансформатор","semantic_hint"]
 ];
 for(const [q,mode] of hints)assert(resolveCategoryIntent(q).mode===mode,q+" expected "+mode);
 const g=resolveCategoryIntent("сервисный центр рога и копыта");
 assert(g.mode==="generic"&&!!g.spec?.osm,"arbitrary text must fall back to generic search");
});

Deno.test("known category qualifiers are preserved safely",()=>{
 const r=resolveCategoryIntent("трансформаторные подстанции 110 кВ");
 assert(r.mode==="qualified","expected qualified mode");
 assert(r.spec?.key.startsWith("power_substation__q_"),"expected qualified substation key");
 assert(r.spec?.osm.includes("110000"),"expected voltage conversion to volts");
});

Deno.test("ambiguous short category asks for clarification",()=>{
 const r=resolveCategoryIntent("станция");
 assert(r.mode==="ambiguous"&&(r.suggestions?.length??0)>=3,"station must be ambiguous");
});

Deno.test("generic SQL predicate is injection-safe",()=>{
 const p=buildSafeGenericPredicate("' OR 1=1; DROP TABLE x; --");
 assert(!!p,"predicate must be built");
 assert(!p!.includes("DROP TABLE"),"raw SQL leaked");
 assert(!p!.includes(";"),"semicolon leaked");
 assert(!p!.includes("--"),"comment marker leaked");
});
