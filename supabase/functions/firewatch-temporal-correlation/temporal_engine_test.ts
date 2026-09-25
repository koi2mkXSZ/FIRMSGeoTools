import {buildTemporalProfile} from "./temporal_engine.ts";
function assert(x:boolean,msg:string){if(!x)throw new Error(msg)}

Deno.test("pre-FIRMS Neptun is preserved with negative offset",()=>{
  const p=buildTemporalProfile("2026-09-25T01:07:00Z",[
    {source:"Neptun",family:"neptun",source_time:"2026-09-25T00:30:18Z",time_semantics:"observed/source",label:"UAV",scale_seconds:21600}
  ]);
  assert(p.timeline[0].offset_seconds===-2202,"expected -2202 s");
  assert(p.flags.includes("neptun_pre_or_at_firms"),"pre flag");
});

Deno.test("OSINT published later is not inverted",()=>{
  const p=buildTemporalProfile("2026-09-25T01:00:00Z",[
    {source:"Telegram OSINT",family:"osint",source_time:"2026-09-25T01:40:00Z",time_semantics:"published",label:"post"}
  ]);
  assert(p.timeline[0].offset_seconds===2400,"expected +2400 s");
  assert(p.timeline[0].relation==="after","after relation");
  assert(p.flags.includes("osint_publication_after_firms"),"publication flag");
});

Deno.test("multi-source alignment produces strong profile",()=>{
  const ref="2026-09-25T01:00:00Z";
  const p=buildTemporalProfile(ref,[
    {source:"Neptun",family:"neptun",source_time:"2026-09-25T00:50:00Z",time_semantics:"observed/source",label:"threat"},
    {source:"OSINT",family:"osint",source_time:"2026-09-25T01:15:00Z",time_semantics:"published",label:"report"},
    {source:"RainViewer",family:"atmosphere",source_time:"2026-09-25T01:03:00Z",time_semantics:"radar_frame",label:"radar",scale_seconds:1200},
    {source:"EUMETSAT FRP",family:"satellite",source_time:"2026-09-25T01:05:00Z",time_semantics:"acquired",label:"FRP",scale_seconds:7200}
  ]);
  assert(p.family_count===4,"four scored families");
  assert((p.consistency_score??0)>=80,"strong consistency");
  assert(p.consistency_level==="strong_alignment","strong level");
});

Deno.test("surface imagery stays on timeline but does not inflate scored coverage",()=>{
  const p=buildTemporalProfile("2026-09-25T01:00:00Z",[
    {source:"Sentinel-2",family:"surface",source_time:"2026-09-20T10:00:00Z",time_semantics:"imagery_before",label:"before"},
    {source:"Sentinel-2",family:"surface",source_time:"2026-09-26T10:00:00Z",time_semantics:"imagery_after",label:"after"}
  ]);
  assert(p.timeline.length===2,"surface timeline retained");
  assert(p.consistency_score===null,"surface does not create event-time score");
  assert(p.consistency_level==="unknown","unknown without comparable family");
});
