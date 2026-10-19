const MAX_BYTES=18000,DEFAULT_URL='https://raw.githubusercontent.com/danielnep/horizon-site/agents/checkpoints/maestro/checkpoint.json';
const ACCEPT=/^https:\/\/raw\.githubusercontent\.com\/danielnep\/horizon-site\/agents\/checkpoints\/maestro\/checkpoint\.json$/;
export function sanitizeCheckpoint(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.schema_version!==2)throw Error('Checkpoint invalido ou versao errada');
 let updated=null;if(input.updated_at!==null){updated=new Date(input.updated_at);if(!Number.isFinite(updated.getTime()))throw Error('Data invalida');}
 const s=x=>typeof x==='string'?x.slice(0,400):'';
 const projects=Array.isArray(input.projects)?input.projects.slice(0,12).map(p=>({repo:s(p.repo),status:s(p.status),evidence:s(p.evidence),next_action:s(p.next_action)})):[];
 const e=input.last_execution||null;
 const last_execution=e&&typeof e==='object'?{id:s(e.id),status:s(e.status),summary:s(e.summary),blocker:s(e.blocker),verification:s(e.verification),handoff_id:s(e.handoff_id)}:null;
 const checkpoint={schema_version:2,updated_at:updated?.toISOString()??null,last_execution,projects};
 if(JSON.stringify(checkpoint).length>MAX_BYTES)throw Error('Checkpoint muito longo');
 return checkpoint;
}
export async function loadCheckpoint({fetcher=fetch,url=DEFAULT_URL,now=new Date()}={}){
 // Compatibilidade com configuracao existente: sempre ler o checkpoint da branch de trabalho.
 if(url==='https://raw.githubusercontent.com/danielnep/horizon-site/main/maestro/checkpoint.json')url=DEFAULT_URL;
 if(!ACCEPT.test(url))return {status:'unavailable',readable:false,checkpoint:null,ageMinutes:null,reason:'Fonte nao autorizada'};
 try{
  const r=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('GitHub HTTP '+r.status);
  const str=await r.text();if(Buffer.byteLength(str)>MAX_BYTES)throw Error('Checkpoint muito grande');
  const checkpoint=sanitizeCheckpoint(JSON.parse(str));
  if(!checkpoint.updated_at)return {status:'awaiting-first-checkpoint',readable:true,checkpoint,ageMinutes:null};
  const age=now.getTime()-new Date(checkpoint.updated_at).getTime();if(age < -300000)throw Error('Checkpoint no futuro');
  // Fresh describes a 72h recency window ONLY; execution is verified by an explicit handoff receipt.
  return {status:age>72*3600000?'stale':'fresh',readable:true,checkpoint,ageMinutes:Math.floor(Math.max(age,0)/60000)};
 }catch(e){return {status:'unavailable',readable:false,checkpoint:null,ageMinutes:null,reason:String(e?.message||e).slice(0,150)};}
}