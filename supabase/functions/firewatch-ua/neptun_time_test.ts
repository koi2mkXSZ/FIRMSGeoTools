import {formatNeptunRelation,neptunTemporalClass} from "./neptun_time.ts";
function assert(x:unknown,msg:string){if(!x)throw new Error(msg)}

Deno.test("Neptun negative offset is before FIRMS",()=>{
  assert(formatNeptunRelation(-2202)==="37 мин до FIRMS","negative relation");
  assert(neptunTemporalClass(-2202)==="before","negative class");
});

Deno.test("Neptun positive offset is after FIRMS",()=>{
  assert(formatNeptunRelation(1468)==="24 мин после FIRMS","positive relation");
  assert(neptunTemporalClass(1468)==="after","positive class");
});

Deno.test("Neptun zero offset is simultaneous",()=>{
  assert(formatNeptunRelation(0)==="одновременно с FIRMS","zero relation");
  assert(neptunTemporalClass(0)==="same","zero class");
});

Deno.test("Neptun invalid offset is explicit",()=>{
  assert(formatNeptunRelation("not-a-time")==="время относительно FIRMS не определено","invalid relation");
  assert(neptunTemporalClass("not-a-time")==="unknown","invalid class");
});
