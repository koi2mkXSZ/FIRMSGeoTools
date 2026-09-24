import {parseRegionalQuery,specFor,validateRegionalCategories} from "./regional_categories.ts";

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
 for(const [q,oblast,category] of cases){const p=parseRegionalQuery(q);assert(p?.oblast===oblast&&p?.category===category,`${q} -> ${JSON.stringify(p)}`)}
});
