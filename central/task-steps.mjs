/** Parse user-written plans; never infer completion from text alone. */
export function splitTaskPlan(value){
 const raw=String(value||'').replace(/\r/g,'').trim();
 if(!raw)return [];
 let parts=raw.split(/\n{1,}|\s+(?=(?:\d{1,2}[.)]\s|[•●]\s))/)
  .map(x=>x.replace(/^\s*(?:\d{1,2}[.):]|\[[xX ]\]|[-*•●])\s*/,'').trim())
  .filter(Boolean);
 if(parts.length===1&&raw.length>200)parts=raw.split(/;\s+(?=[A-Za-zÀ-ÿ])/).filter(Boolean);
 if(parts.length===1&&raw.length>340)parts=raw.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/).filter(Boolean);
 return parts.slice(0,30).map(x=>x.slice(0,800));
}
export function taskPlanStatus(items,stages){
 const done=['succeeded','completed'];
 const match=items.length===stages.length&&items.length>0;
 return items.map((text,i)=>({
  text,
  state:match?String(stages[i]?.state||'pending'):'pending',
  verified:match&&done.includes(stages[i]?.state),
  agent:match?stages[i]?.agent||null:null,
  grounded:match
 }));
}
