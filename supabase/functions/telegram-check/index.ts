import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(async()=>new Response(JSON.stringify({ok:true,mode:"health-check"}),{headers:{"content-type":"application/json"}}));
