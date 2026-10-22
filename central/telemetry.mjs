import {readFile,stat,appendFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {directRoot} from '../maestro/direct-queue.mjs';
const ALLOWED=new Set(['thinking','started','read_file','list_files','write_file','run_check','finish','remember','delegate','search_web','fetch_public','inspect_image']);
const number=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const id=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{2,79}$/.test(x)?x:null;
const provider=x=>x==='groq'||x==='gemini'||x==='central-groq'?x:null;
const recentDate=(d)=>new Date(Date.now()-d*86400000).toISOString().slice(0,10);
const MAX_BYTES=8*1024*1024;
async function rows(kind,days){
 const dir=join(directRoot(),'telemetry'),out=[];let incomplete=false;
 for(let i=days-1;i>=0;i--){
  const path=join(dir,kind+'-'+recentDate(i)+'.jsonl');
  try{
   const metadata=await stat(path);
   if(metadata.size>MAX_BYTES){incomplete=true;continue;}
   const content=await readFile(path,'utf8');
   for(const line of content.split('\n')){
    if(!line||line.length>900)continue;
    try{const item=JSON.parse(line);if(item&&typeof item==='object')out.push(item);}catch{incomplete=true;}
   }
  }catch(e){if(e.code!=='ENOENT')incomplete=true;}
 }
 return {rows:out,incomplete};
}
export async function operationalTelemetry(days=7){
 const [usage,activity]=await Promise.all([rows('usage',days),rows('activity',Math.min(days,2))]);
 const byProvider={},byAgent={},byModel={};let input=0,output=0,total=0,calls=0,missing=0;
 for(const item of usage.rows){
  const p=provider(item.provider),a=id(item.agent),m=typeof item.model==='string'&&item.model.length<100?item.model:null;
  if(!p||!a||!m)continue;
  const inp=number(item.input),out=number(item.output),sum=number(item.total);
  if(inp===null&&out===null&&sum===null){missing++;continue;}
  calls++;input+=inp||0;output+=out||0;total+=sum??((inp||0)+(out||0));
  for(const [obj,key] of [[byProvider,p],[byAgent,a],[byModel,m]]){
   if(!obj[key])obj[key]={total:0,input:0,output:0,calls:0};
   obj[key].input+=inp||0;obj[key].output+=out||0;obj[key].total+=sum??((inp||0)+(out||0));obj[key].calls++;
  }
 }
 const byTask={},latest=[];
 const sorted=activity.rows.filter(item=>id(item.taskId)&&id(item.agent)&&ALLOWED.has(item.action)&&Number.isFinite(Date.parse(item.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 for(const item of sorted.slice(-650)){
  const event={at:item.at,taskId:item.taskId,agent:item.agent,action:item.action,
   step:number(item.step),path:typeof item.path==='string'&&item.path.length<=140?item.path:null};
  byTask[item.taskId]=event;latest.push(event);
 }
 return {usage:{input:input||0,output:output||0,total:total||0,calls,byAgent,byProvider,byModel,
  days,available:calls>0,partial:usage.incomplete,unavailableCalls:missing,
  origin:'Respostas reais dos provedores, registradas na fila privada da VPS'},
  activity:{lastByTask:byTask,recent:latest.slice(-80),available:latest.length>0,partial:activity.incomplete}};
}
export async function recordCentralUsage(model,usage,providerName='groq'){
 const input=number(usage?.prompt_tokens),output=number(usage?.completion_tokens),total=number(usage?.total_tokens);
 if(input===null&&output===null&&total===null)return false;
 const date=new Date().toISOString().slice(0,10);
 const dir=join(directRoot(),'telemetry');
 try{
  await mkdir(dir,{recursive:true,mode:0o700});
  await appendFile(join(dir,'usage-'+date+'.jsonl'),JSON.stringify({
   at:new Date().toISOString(),agent:'central-horizon',provider:providerName==='gemini'?'gemini':'central-groq',model,
   input,output,total,source:'provider_response'})+'\n',{mode:0o600});
  return true;
 }catch{return false;}
}
