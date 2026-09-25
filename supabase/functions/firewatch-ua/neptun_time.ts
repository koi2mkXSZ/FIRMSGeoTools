export function formatNeptunRelation(offsetSeconds:unknown){
  const off=Number(offsetSeconds);
  if(!Number.isFinite(off))return "время относительно FIRMS не определено";
  if(off===0)return "одновременно с FIRMS";
  const mins=Math.round(Math.abs(off)/60);
  return off<0?`${mins} мин до FIRMS`:`${mins} мин после FIRMS`;
}

export function neptunTemporalClass(offsetSeconds:unknown){
  const off=Number(offsetSeconds);
  if(!Number.isFinite(off))return "unknown" as const;
  if(off<0)return "before" as const;
  if(off>0)return "after" as const;
  return "same" as const;
}
