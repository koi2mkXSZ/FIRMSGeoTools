export type TgPost={message_id:number;published_at:string;text:string;url:string};

function decodeHtml(s:string){
  const named:Record<string,string>={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
  return s
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/&([a-z]+);/gi,(m,n)=>named[n]??m)
    .replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").trim();
}
export function classify(text:string){
  const s=text.toLowerCase();
  if(/розвід|развед|recon|supercam|орлан/.test(s))return"recon";
  if(/баліст|балист|ballistic|іскандер|искандер|кинжал|кинджал|kinzhal/.test(s))return"ballistic";
  if(/\bкаб\b|умпб|авіабомб|авиабомб|guided bomb/.test(s))return"kab";
  if(/shahed|шахед|герань|geran|бпла|бпіл|дрон|uav|реактивн.*бп/.test(s))return"uav";
  if(/ракет|missile|калібр|калибр|kalibr|х-\d|kh-\d/.test(s))return"missile";
  if(/міг-?31|миг-?31|tu-?95|ту-?95|зліт|взлет|takeoff/.test(s))return"aviation";
  return"other";
}
export function parseTelegramPage(html:string,handle:string):TgPost[]{
  const h=handle.replace(/^@/,"");
  const esc=h.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
  const re=new RegExp('<div[^>]+data-post="'+esc+'\\/(\\d+)"[\\s\\S]*?(?=<div[^>]+data-post="'+esc+'\\/|$)','g');
  const out:TgPost[]=[];let m:RegExpExecArray|null;
  while((m=re.exec(html))){
    const block=m[0],id=Number(m[1]);
    const tm=block.match(/datetime="([^"]+)"/);
    if(!tm||!Number.isFinite(id))continue;
    const tx=block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text=decodeHtml(tx?.[1]??"");
    out.push({message_id:id,published_at:new Date(tm[1]).toISOString(),text,url:"https://t.me/"+h+"/"+id});
  }
  return out;
}
