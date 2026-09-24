import {buildFilterPredicate,buildSafeGenericPredicate,extractRegionalFilters,mergeFilters,multiKey,parseRegionalQuery,resolveCategoryIntent,resolveCategoryList,splitObjectExpression,specFor,validateRegionalCategories} from "./regional_categories.ts";
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


Deno.test("Stage 43.1 filters parse safely",()=>{
 const x=extractRegionalFilters('АЗС + нефтебазы brand:WOG operator:"ООО Надежда" city:Кременчуг address:"ул. Киевская"');
 assert(x.text==="АЗС + нефтебазы","filter tokens must be removed from expression");
 assert(x.filters.brand==="WOG","brand missing");
 assert(x.filters.operator==="ООО Надежда","operator missing");
 assert(x.filters.settlement==="Кременчуг","settlement missing");
 assert(x.filters.address==="ул. Киевская","address missing");
 const p=buildFilterPredicate(x.filters);
 assert(!p.includes("addr:city")&&p.includes("brand")&&p.includes("operator")&&p.includes("addr:street"),"filter SQL pushdown mismatch");
 assert(!p.includes("DROP TABLE"),"unsafe SQL leaked");
});

Deno.test("Stage 43.1 multi-category plan resolves independently",()=>{
 const parts=splitObjectExpression("АЗС + нефтебазы + резервуары");
 assert(parts.length===3,"expected 3 categories");
 const plan=resolveCategoryList(parts);
 assert(!plan.ambiguous,"multi-category should not be ambiguous");
 assert(plan.resolutions.length===3,"expected 3 unique resolutions");
 const modes=plan.resolutions.map(x=>x.mode);
 assert(modes.includes("canonical")&&modes.includes("semantic_hint"),"expected mixed resolution modes");
});

Deno.test("Stage 43.1 cache key changes with filters",()=>{
 const p=resolveCategoryList(splitObjectExpression("АЗС + резервуары")).resolutions;
 const a=multiKey(p,{brand:"WOG"});
 const b=multiKey(p,{brand:"OKKO"});
 const c=multiKey(p,{brand:"WOG"});
 assert(a!==b,"different filters must have different keys");
 assert(a===c,"same plan must have deterministic key");
});

Deno.test("Stage 43.1 explicit filters override parsed filters",()=>{
 const parsed=extractRegionalFilters("АЗС city:Полтава brand:WOG");
 const merged=mergeFilters(parsed.filters,{settlement:"Кременчуг"});
 assert(merged.settlement==="Кременчуг","explicit settlement override failed");
 assert(merged.brand==="WOG","unrelated parsed filter lost");
});


Deno.test("Stage 43.1 post-enrichment filters parse",()=>{
 const x=extractRegionalFilters('АЗС city:Полтава source:OSM confidence:90 has_address:yes');
 assert(x.filters.settlement==="Полтава","settlement filter");
 assert(x.filters.source==="OSM","source filter");
 assert(x.filters.min_confidence==="90","confidence filter");
 assert(x.filters.has_address==="yes","has_address filter");
 const p=buildFilterPredicate(x.filters);
 assert(!p.includes("addr:city"),"settlement must not be pre-filtered before spatial enrichment");
});

Deno.test("Stage 43.1 filter key includes post filters",()=>{
 const p=resolveCategoryList(splitObjectExpression("АЗС")).resolutions;
 const a=multiKey(p,{source:"OSM",min_confidence:"90",has_address:"yes"});
 const b=multiKey(p,{source:"Wikidata",min_confidence:"90",has_address:"yes"});
 assert(a!==b,"source post-filter must affect cache key");
});
