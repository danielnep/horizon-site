import {request as httpRequest} from 'node:http';
/**
 * Central Horizon -> Hostinger VPS adapter.
 *
 * The old Railway-local queue and its volumes are intentionally NEVER used as
 * a fallback. A missing/unreachable VPS is reported as disconnected, not idle.
 *
 * Required on the dashboard host:
 *   HORIZON_VPS_API_URL=https://<verified-vps-control-domain>
 *   HORIZON_VPS_API_TOKEN=<server-to-server-secret>
 *
 * The authenticated VPS service implements:
 * GET /v1/snapshot
 * POST /v1/tasks
 * POST /v1/tasks/:taskId/actions
 * POST /v1/agents/:agentId/actions
 */
const ID=/^[a-z0-9][a-z0-9-]{2,79}$/;
const TASK_ID=/^[a-z0-9][a-z0-9:-]{2,109}$/;
const ACTIONS=new Set(['pause','resume','cancel','retry']);
const AGENT_ACTIONS=new Set(['pause','resume']);

export function vpsConnectionConfig(env=process.env){
 const value=String(env.HORIZON_VPS_API_URL||'').trim();
 const socket=String(env.HORIZON_VPS_API_SOCKET||'').trim();
 const token=String(env.HORIZON_VPS_API_TOKEN||'');
 if(socket){
  if(!socket.startsWith('/run/horizon-central/')||!/^\/run\/horizon-central\/[a-z0-9._-]+\.sock$/.test(socket))return {ok:false,reason:'socket_vps_invalido'};
  if(token.length<32)return {ok:false,reason:'credencial_vps_nao_configurada'};
  return {ok:true,socket,token};
 }
 if(!value||!token)return {ok:false,reason:'endereco_ou_credencial_vps_nao_configurados'};
 let url;
 try{url=new URL(value);}catch{return {ok:false,reason:'endereco_vps_invalido'};}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'&&url.pathname!==''){
  return {ok:false,reason:'endereco_vps_deve_usar_https'};
 }
 // Only the operator's verified domain is accepted. No fallback to old Railway.
 return {ok:true,url:url.origin,token};
}
function normalizeStages(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,30).filter(v=>v&&typeof v==='object').map(x=>({
  agent:typeof x.agent==='string'?x.agent:null,
  state:String(x.state||x.status||'sem telemetria individual').slice(0,80),
  summary:String(x.summary||'').slice(0,600),
  blocker:x.blocker?String(x.blocker).slice(0,300):null,
  checks:Number.isSafeInteger(x.checks)?x.checks:0,
 }));
}
export function disconnectedVps(reason='VPS sem comunicação'){
 return {
  at:new Date().toISOString(),source:'VPS Hostinger',
  connection:{state:'disconnected',message:reason},
  tasks:[],agents:[],events:[],activity:[],
  worker:{status:'Sem ligação com a VPS',lastCycle:null},
  available:{vps:false,queue:false,results:false,attendance:false},
  usage:{available:false,input:null,output:null,total:null,calls:0,byAgent:{},byProvider:{},byModel:{}},
  issues:[reason],
 };
}
export function normalizeVpsSnapshot(value,agentIds=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.source!=='vps'){
  throw new Error('resposta_vps_invalida');
 }
 const data=value;
 const agentMap=new Map((Array.isArray(data.agents)?data.agents:[]).filter(a=>a&&ID.test(a.id)).map(a=>[a.id,a]));
 const agents=agentIds.map(id=>{
  const found=agentMap.get(id);
  return {id,status:found?String(found.status||'não informado').slice(0,90):'sem telemetria individual',
   held:found?.held===true,currentTask:typeof found?.currentTask==='string'?found.currentTask:null,
   updatedAt:typeof found?.updatedAt==='string'?found.updatedAt:null};
 });
 const tasks=(Array.isArray(data.tasks)?data.tasks:[]).filter(t=>t&&TASK_ID.test(t.id)).slice(0,200).map(t=>({
  id:t.id,project:String(t.project||'não informado').slice(0,90),
  repository:String(t.repository||'').slice(0,120),title:String(t.title||'Sem descrição').slice(0,200),
  description:String(t.description||t.title||'').slice(0,2800),
  agent:typeof t.agent==='string'?t.agent:null,priority:typeof t.priority==='string'?t.priority:null,
  status:String(t.status||'não informado').slice(0,110),
  rawStatus:String(t.rawStatus||t.status||'').slice(0,110),
  inQueue:t.inQueue===true,hasResult:t.hasResult===true,approved:t.approved===true,
  published:t.published===true,
  progress:t.progress&&Number.isInteger(t.progress.done)&&Number.isInteger(t.progress.total)?{
   done:t.progress.done,total:t.progress.total,verified:Number.isInteger(t.progress.verified)?t.progress.verified:0,
  }:null,
  stages:normalizeStages(t.stages),blocker:t.blocker?String(t.blocker).slice(0,260):null,
  updatedAt:typeof t.updatedAt==='string'?t.updatedAt:null,
  lastActivity:t.lastActivity&&typeof t.lastActivity==='object'?{
   at:t.lastActivity.at||null,agent:t.lastActivity.agent||null,action:t.lastActivity.action||null,
   step:Number.isInteger(t.lastActivity.step)?t.lastActivity.step:null,
   path:typeof t.lastActivity.path==='string'?t.lastActivity.path.slice(0,140):null,
  }:null,
 }));
 const u=data.usage&&typeof data.usage==='object'?data.usage:{};
 const usage=u.available===true?{
  available:true,input:Number.isFinite(u.input)?u.input:null,
  output:Number.isFinite(u.output)?u.output:null,total:Number.isFinite(u.total)?u.total:null,
  calls:Number.isSafeInteger(u.calls)?u.calls:0,days:Number.isSafeInteger(u.days)?u.days:7,
  byAgent:u.byAgent&&typeof u.byAgent==='object'?u.byAgent:{},
  byProvider:u.byProvider&&typeof u.byProvider==='object'?u.byProvider:{},
  byModel:u.byModel&&typeof u.byModel==='object'?u.byModel:{},
  origin:'Respostas dos provedores registradas na VPS'
 }:{available:false,input:null,output:null,total:null,calls:0,byAgent:{},byProvider:{},byModel:{}};
 const worker=data.worker&&typeof data.worker==='object'?data.worker:{};
 const activity=Array.isArray(data.activity)?data.activity.slice(-100):[];
 const events=Array.isArray(data.events)?data.events.slice(-80).filter(e=>e&&typeof e==='object').map(e=>({
  id:e.id||null,kind:String(e.kind||'vps').slice(0,40),
  event:String(e.event||'atualizacao').slice(0,80),
  at:typeof e.at==='string'?e.at:null,
  rc:e.rc??null,reason:e.reason?String(e.reason).slice(0,200):null,
 })):[];
 return {at:new Date().toISOString(),source:'VPS Hostinger',
  connection:{state:'connected',message:'Dados da VPS recebidos',verifiedAt:new Date().toISOString()},
  agents,tasks,activity,events,worker:{status:String(worker.status||'sem telemetria').slice(0,100),
    lastCycle:worker.lastCycle||null},
  available:{vps:true,queue:data.available?.queue===true,
   results:data.available?.results===true,attendance:data.available?.attendance===true},
  issues:Array.isArray(data.issues)?data.issues.slice(0,12).map(x=>String(x).slice(0,200)):[],
  usage,
 };
}

async function unixRequest(socket,path,{method,data,token}){
 return new Promise((resolve,reject)=>{
  const payload=data===undefined?null:Buffer.from(JSON.stringify(data));
  const call=httpRequest({
   socketPath:socket,path,method,timeout:8500,
   headers:{authorization:'Bearer '+token,accept:'application/json',
    ...(payload?{'content-type':'application/json','content-length':payload.byteLength}:{})}
  },res=>{
   let value='';res.setEncoding('utf8');
   res.on('data',chunk=>{value+=chunk;if(value.length>3_000_000)call.destroy(new Error('resposta_vps_grande'));});
   res.on('end',()=>{
    if(res.statusCode<200||res.statusCode>=300)return reject(new Error('vps_http_'+res.statusCode));
    try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object')throw Error('resposta_vps_invalida');resolve(parsed);}
    catch{reject(new Error('resposta_vps_invalida'));}
   });
  });
  call.on('timeout',()=>call.destroy(new Error('tempo_limite_vps')));
  call.on('error',reject);
  if(payload)call.write(payload);
  call.end();
 });
}

export async function vpsRequest(path,{method='GET',data,fetcher=fetch,env=process.env}={}){
 const conn=vpsConnectionConfig(env);
 if(!conn.ok)throw new Error(conn.reason);
 if(!/^\/v1\/[a-z0-9/_-]+$/.test(path)||path.includes('//'))throw new Error('rota_vps_invalida');
 if(conn.socket)return unixRequest(conn.socket,path,{method,data,token:conn.token});
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),8500);
 try{
  const response=await fetcher(conn.url+path,{
   method,redirect:'error',signal:ctrl.signal,
   headers:{authorization:'Bearer '+conn.token,accept:'application/json',
     ...(data!==undefined?{'content-type':'application/json'}:{})},
   ...(data!==undefined?{body:JSON.stringify(data)}:{})
  });
  if(!response.ok)throw new Error('vps_http_'+response.status);
  const json=await response.json();
  if(json===null||typeof json!=='object')throw new Error('resposta_vps_invalida');
  return json;
 }finally{clearTimeout(timer);}
}
export async function vpsSnapshot(agentIds,options={}){
 const packet=await vpsRequest('/v1/snapshot',options);
 return normalizeVpsSnapshot(packet,agentIds);
}
export async function vpsSubmitTask(payload,options={}){
 const result=await vpsRequest('/v1/tasks',{...options,method:'POST',data:payload});
 if(!result?.id||!TASK_ID.test(result.id))throw new Error('envio_vps_sem_confirmacao');
 return result;
}
export async function vpsTaskAction(id,action,options={}){
 if(!TASK_ID.test(id)||!ACTIONS.has(action))throw new Error('comando_invalido');
 return vpsRequest('/v1/tasks/'+id+'/actions',{...options,method:'POST',data:{action}});
}
export async function vpsAgentAction(id,action,options={}){
 if(!ID.test(id)||!AGENT_ACTIONS.has(action))throw new Error('comando_invalido');
 return vpsRequest('/v1/agents/'+id+'/actions',{...options,method:'POST',data:{action}});
}
