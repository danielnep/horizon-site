import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {submitDirectTask,directTasks} from '../maestro/direct-queue.mjs';

export const SPECIALISTS=Object.freeze([
'may-maestro','horizon-project-studio','software-architect','frontend-engineer','backend-engineer','mobile-app-builder','ui-ux-designer','horizon-ui-guardian','database-engineer','integration-engineer','qa-engineer','security-engineer','devops-engineer','horizon-evolution-agent','horizon-skills','corregedoria-may','may-persona']);
const ROOT='https://api.github.com/repos/danielnep/May-Maestro-Executor/';
const ASSETS=Object.freeze({
'':'index.html','index.html':'index.html','app.js':'app.js','style.css':'style.css',
'manifest.webmanifest':'manifest.webmanifest','sw.js':'sw.js','icon.svg':'icon.svg','icon-192.png':'icon-192.png','icon-512.png':'icon-512.png'});
const MIME={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png'};
const ID=/^[a-z0-9][a-z0-9-]{2,63}$/;
const REPO=/^danielnep\/[a-z0-9._-]{2,90}$/i;
const PATH=/^(?!\/)(?!.*(?:^|\/)\.)(?!.*\.\.)(?!.*[\\])[a-zA-Z0-9_./*-]{1,120}$/;
const origins=new Map();
const live=new Set();
const events=[];
let sequence=0, lastCycle=null, workerState='não verificado';
let monitorTimer=null,monitorDigest=null,monitorPending=false;
let githubCache={expires:0,value:null,promise:null};
const taskDocumentCache=new Map();
let repoCache={expires:0,value:null,promise:null};
const REPO_LABELS={'romaneio-digital':'Romaneio Digital','app-hondas-maxvel':'Ronda Pro','michelle-preview':'Painel Michelle','horizon-site':'Horizon Site','horizon-preview':'Horizon Preview','sistema-fluxo-restaurantes':'Fluxo Restaurantes','app-desert-falcons':'Desert Falcons','May-Maestro-Executor':'Maestro / Executor'};
let aiBudget=new Map();
function send(res,status,value,headers={}){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff',...headers});
  res.end(JSON.stringify(value));
}
function sec(){return process.env.HORIZON_CONTROL_PASSWORD||process.env.HORIZON_MCP_TOKEN||'';}
function same(a,b){if(!a||!b)return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function signature(message){return createHmac('sha256',sec()).update('horizon-control:v1:'+message).digest('base64url');}
function authenticated(req){
 const match=(req.headers.cookie||'').match(/(?:^|;\s*)horizon_session=([^;]+)/);
 if(!sec()||!match)return false;
 const [stamp,sig]=decodeURIComponent(match[1]).split('.');
 const timestamp=Number(stamp);
 return Number.isSafeInteger(timestamp)&&timestamp<=Date.now()+30000&&timestamp>Date.now()-43200000&&same(signature(stamp),sig);
}
function sameOrigin(req){
 const origin=req.headers.origin;if(!origin)return false;
 try{const target=new URL(origin);return target.protocol==='https:'&&target.host===req.headers.host;}catch{return false;}
}
async function body(req,max=6000){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('json_required');
 let size=0;const buffers=[];
 for await(const part of req){size+=part.length;if(size>max)throw Error('payload_too_large');buffers.push(part);}
 try{return JSON.parse(Buffer.concat(buffers).toString('utf8'));}catch{throw Error('invalid_json');}
}
function notify(kind,content){
 const data={id:++sequence,at:new Date().toISOString(),kind,...content};
 events.push(data);if(events.length>160)events.shift();
 for(const res of live)try{res.write('id: '+data.id+'\nevent: update\ndata: '+JSON.stringify(data)+'\n\n');}catch{live.delete(res);}
}
function parseAgentLog(line){
 const text=String(line).slice(0,600);
 if(!text.startsWith('[horizon-team] '))return;
 const value=text.slice(15);
 const match=value.match(/^([a-z_]+)\s*(\{.*\})?$/);
 if(!match)return;
 let metadata={};try{metadata=match[2]?JSON.parse(match[2]):{};}catch{}
 const kind=match[1];
 const selected={};
 for(const k of ['rc','code','signal','reason','errorClass','processed','rejected','ready_for_continuation','count','agents','workers','retrySeconds','taskId','state']){
   if(typeof metadata[k]==='number'||typeof metadata[k]==='boolean'||typeof metadata[k]==='string')selected[k]=String(metadata[k]).slice(0,100);
 }
 if(kind==='started')workerState='iniciado';
 if(kind==='exited'||kind==='cycle_failed'||kind==='stopped')workerState='falha registrada';
 if(kind==='cycle'&&Number(metadata.rc)===0)workerState='ciclo concluído';
 if(kind==='cycle'||kind==='cycle_failed'||kind==='exited')lastCycle={kind,at:new Date().toISOString(),...selected};
 if(githubCache.value){githubCache.value.worker={status:workerState,lastCycle};}
 notify('worker',{event:kind,...selected});
}
export const teamLog=(line)=>{console.log(line);parseAgentLog(line);};
export const teamError=(line)=>{console.error(line);parseAgentLog(line);};
async function github(path,{method='GET',value}={}){
 const token=process.env.GITHUB_TOKEN;
 if(!token)throw Error('github_token_not_configured');
 const url=ROOT+path;
 const response=await fetch(url,{method,headers:{'authorization':'Bearer '+token,'accept':'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'Horizon-Control/1',...(value?{'content-type':'application/json'}:{})},body:value?JSON.stringify(value):undefined,signal:AbortSignal.timeout(12500)});
 if(response.status===404)return null;
 if(!response.ok)throw Error('github_http_'+response.status);
 return response.json();
}
async function list(path){const value=await github('contents/'+path+'?ref=main');return Array.isArray(value)?value.filter(x=>x.type==='file'&&x.name.endsWith('.json')).slice(0,60):[];}
async function file(path,knownSha=null){
 if(knownSha&&taskDocumentCache.get(path)?.sha===knownSha)return taskDocumentCache.get(path).value;
 const item=await github('contents/'+path+'?ref=main');
 if(!item?.content)return null;
 try{
  const value=JSON.parse(Buffer.from(item.content.replace(/\s/g,''),'base64').toString('utf8'));
  if(knownSha){
   taskDocumentCache.set(path,{sha:knownSha,value});
   if(taskDocumentCache.size>160)taskDocumentCache.delete(taskDocumentCache.keys().next().value);
  }
  return value;
 }catch{return null;}
}
function statusLabel(obj){
 const state=String(obj?.status||obj?.state||'').toLowerCase();
 if(['completed','done','succeeded'].includes(state)){
  return obj?.quality?.approved===true&&obj?.publication?.published===true?'concluída':'aguardando validação';
 }
 if(/fail|error|block|rejected/.test(state))return 'bloqueada';
 if(/run|active|claim|working|progress/.test(state))return 'em execução';
 if(/waiting|await|pending|defer/.test(state))return 'aguardando';
 return 'na fila';
}

async function githubOwner(endpoint){
 const token=process.env.GITHUB_TOKEN;
 const response=await fetch('https://api.github.com/'+endpoint,{
  headers:{accept:'application/vnd.github+json','user-agent':'Horizon-Control/1',
   ...(token?{authorization:'Bearer '+token}:{})},
  signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('github_repos_http_'+response.status);
 return response.json();
}
export async function ownerRepositories(){
 if(repoCache.value&&repoCache.expires>Date.now())return repoCache.value;
 if(repoCache.promise)return repoCache.promise;
 repoCache.promise=(async()=>{
  const pages=[];
  for(let page=1;page<=3;page++){
   const chunk=await githubOwner('users/danielnep/repos?per_page=100&page='+page+'&sort=updated&type=owner');
   if(!Array.isArray(chunk))throw Error('resposta_repositorios_invalida');
   pages.push(...chunk);
   if(chunk.length<100)break;
  }
  const repositories=pages.filter(x=>x?.owner?.login==='danielnep'&&x.private!==true&&!x.archived)
  .map(x=>({name:String(x.name),repository:String(x.full_name),label:REPO_LABELS[x.name]||String(x.name).replace(/-/g,' '),
   description:String(x.description||'').slice(0,150),defaultBranch:String(x.default_branch||'main')}))
  .filter(x=>REPO.test(x.repository))
  .sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
  repoCache.value=repositories;repoCache.expires=Date.now()+300000;
  return repositories;
 })().finally(()=>{repoCache.promise=null});
 return repoCache.promise;
}
export function deriveCodePaths(items,repo){
 if(!Array.isArray(items))return [];
 const dirs=['src','app','js','css','assets','public','server','scripts','is','lib','components','pages','dist','tests','ferramentas','central','integrations','docs','analysis'];
 const allowedFiles=/\.(html|css|js|mjs|jsx|ts|tsx|svg|webmanifest|json)$/i;
 const restricted=/(\.env|lock\.json|credential|password|secret|private.?key|token|\.sqlite|\.db$)/i;
 const blockedRepo=repo==='danielnep/May-Maestro-Executor'?new Set(['agents','horizon_core','sandbox','android_tools','maestro_exec','executors','tasks','tests']):new Set();
 const folderPaths=dirs.filter(name=>!blockedRepo.has(name)&&items.some(x=>x.type==='dir'&&x.name===name)).map(name=>name+'/**');
 const filenames=items.filter(x=>x.type==='file'&&allowedFiles.test(x.name)&&!restricted.test(x.name)&&!x.name.startsWith('.')).map(x=>x.name);
 return [...folderPaths,...filenames].slice(0,25);
}
async function resolveTaskDefaults(value){
 if(!value||typeof value!=='object')throw Error('solicitacao_invalida');
 const repo=String(value.repository||'');
 const paths=Array.isArray(value.allowed_paths)&&value.allowed_paths.length?value.allowed_paths:null;
 // Preserve explicit scoped submissions without a redundant remote lookup.
 if(paths&&REPO.test(repo))return {...value,project:String(value.project||repo.split('/')[1]).toLowerCase()};
 const repositories=await ownerRepositories();
 const selected=repositories.find(x=>x.repository===repo);
 if(!selected)throw Error('selecione_um_repositorio_da_lista');
 const valueProject=String(value.project||selected.name).toLowerCase();
 if(value.delivery_type==='new_product')return {...value,project:valueProject,repository:repo,allowed_paths:[]};
 const root=await githubOwner('repos/'+repo+'/contents?ref='+encodeURIComponent(selected.defaultBranch));
 const resolved=deriveCodePaths(root,repo);
 if(!resolved.length)throw Error('nao_encontrei_arquivos_editaveis_nesse_projeto');
 return {...value,project:valueProject,repository:repo,allowed_paths:resolved};
}

async function loadOverview(){
 if(githubCache.value&&Date.now()<githubCache.expires)return githubCache.value;
 if(githubCache.promise)return githubCache.promise;
 githubCache.promise=(async()=>{
  const [queued,attendance]=await Promise.allSettled([
   directTasks(),file('tasks/attendance/equipe.json')]);
  const q=queued.status==='fulfilled'?queued.value:[];
  const queueResults=q;
  const members=attendance.status==='fulfilled'&&attendance.value&&typeof attendance.value==='object'?attendance.value:null;
  const agents=SPECIALISTS.map(id=>{
   let rec=null;
   if(Array.isArray(members?.agents))rec=members.agents.find(x=>x.id===id||x.agent===id);
   else if(members?.agents&&typeof members.agents==='object')rec=members.agents[id]||null;
   return {id,status:typeof rec?.status==='string'?rec.status:'sem telemetria individual',
   currentTask:typeof rec?.current_task==='string'?rec.current_task:(typeof rec?.task_ref==='string'?rec.task_ref:null),
   updatedAt:typeof rec?.updated_at==='string'?rec.updated_at:null};
  });
  const issues=[];
  if(queued.status==='rejected')issues.push('Fila Railway temporariamente indisponível');
  if(attendance.status==='rejected')issues.push('Presença individual indisponível');
  return {at:new Date().toISOString(),source:'Fila direta Railway e telemetria deste processo',
   tasks:queueResults.filter(Boolean),agents,worker:{status:workerState,lastCycle},issues,
   available:{queue:queued.status==='fulfilled',results:queued.status==='fulfilled',attendance:attendance.status==='fulfilled'},
   usage:{status:'sem dados de tokens por chamada',input:null,output:null,total:null}};
 })().then(v=>{githubCache.value=v;githubCache.expires=Date.now()+16000;return v}).finally(()=>{githubCache.promise=null});
 return githubCache.promise;
}

// The live stream receives worker events immediately. GitHub is the durable
// source for queues/attendance, so reconcile it at most every 20 seconds while
// a dashboard is connected, then push only real changes via SSE.
export function operationalDigest(data){
 if(!data||typeof data!=='object')return '';
 return JSON.stringify({
  tasks:data.tasks??[],agents:data.agents??[],
  available:data.available??{},issues:data.issues??[],
 });
}
async function pollLiveState(){
 if(monitorPending||live.size===0)return;
 monitorPending=true;
 try{
  const view=await loadOverview();
  const digest=operationalDigest(view);
  if(monitorDigest!==null&&monitorDigest!==digest){
   notify('state',{event:'snapshot_changed',tasks:view.tasks.length,agents:view.agents.length});
  }
  monitorDigest=digest;
 }catch{
  notify('system',{event:'snapshot_unavailable'});
 }finally{monitorPending=false;}
}
function startLiveMonitor(){
 if(monitorTimer!==null)return;
 monitorDigest=null;
 monitorTimer=setInterval(()=>void pollLiveState(),20000);
 monitorTimer.unref?.();
 void pollLiveState();
}
function stopLiveMonitorIfUnused(){
 if(live.size!==0||monitorTimer===null)return;
 clearInterval(monitorTimer);
 monitorTimer=null;
 monitorDigest=null;
}

const authAttempts=new Map();
function limit(key,cap=6,window=900000){
 const now=Date.now();let entry=authAttempts.get(key);
 if(!entry||entry.until<now)entry={until:now+window,count:0};
 entry.count++;authAttempts.set(key,entry);
 return entry.count<=cap;
}
async function interpret(payload){
 if(!limit('ai',8,60000))return {error:'limite_de_consultas',status:429};
 const message=String(payload?.message||'').trim();
 if(message.length<12||message.length>1600)return {error:'mensagem_deve_ter_12_a_1600_caracteres',status:400};
 const prompt='Você auxilia a central dos 17 agentes Horizon. Responda em português simples, com no máximo 100 palavras. Entenda a intenção, identifique projeto e agentes sugeridos, risco e próximo passo. Não invente estados, percentuais, logs, acessos ou conclusão. Não execute comandos nem inclua segredos.\nPedido: '+message;
 const groqKey=process.env.GROQ_API_KEY||process.env.API_IA_GROQ;
 if(!groqKey)return {error:'provedor_ia_nao_configurado',status:503};
 const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',
  headers:{'authorization':'Bearer '+groqKey,'content-type':'application/json'},
  body:JSON.stringify({model:process.env.HORIZON_CONTROL_AI_MODEL||'openai/gpt-oss-120b',messages:[{role:'user',content:prompt}],max_completion_tokens:260,temperature:0.2}),
  signal:AbortSignal.timeout(17000)});
 if(!response.ok)return {error:'provedor_http_'+response.status,status:502};
 const data=await response.json();
 const content=data.choices?.[0]?.message?.content;
 if(typeof content!=='string'||!content.trim())return {error:'resposta_ia_indisponivel',status:502};
 const usage=data.usage||{};
 return {response:content.slice(0,1300),usage:{input:Number.isFinite(usage.prompt_tokens)?usage.prompt_tokens:null,
 output:Number.isFinite(usage.completion_tokens)?usage.completion_tokens:null},status:200};
}
async function createTask(value){
 const normalized=await resolveTaskDefaults(value);
 const result=await submitDirectTask(normalized);
 githubCache.expires=0;
 notify('task',{event:'submitted',taskId:result.id,project:String(value.project||'')});
 return {...result,note:'Maestro recebeu a solicitação no Railway; execução será confirmada pelo worker.'};
}
export async function handleCentral(req,res,{reader=readFile}={}){
 const raw=(req.url||'/central/').split('?')[0];
 if(raw!=='/central'&&!raw.startsWith('/central/'))return false;
 if(raw==='/central'){res.writeHead(308,{location:'/central/'});res.end();return true;}
 if(!raw.startsWith('/central/api/')){
  if(req.method!=='GET'&&req.method!=='HEAD'){send(res,405,{error:'method_not_allowed'});return true;}
  let route;try{route=decodeURIComponent(raw.slice('/central/'.length));}catch{send(res,400,{error:'invalid_path'});return true;}
  const asset=ASSETS[route];
  if(!asset){send(res,404,{error:'not_found'});return true;}
  try{const value=await reader(fileURLToPath(new URL('./'+asset,import.meta.url)));
   const ext=asset.split('.').pop();
   const headers={'content-type':MIME[ext]||'application/octet-stream','x-content-type-options':'nosniff',
    'cache-control':asset==='sw.js'||asset==='index.html'?'no-cache':'public, max-age=300',
    'content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy':'no-referrer'};
   res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:value);
  }catch{send(res,503,{error:'painel_indisponivel'});}return true;
 }
 if(raw==='/central/api/session'&&req.method==='GET'){
  send(res,200,{authenticated:authenticated(req),configured:Boolean(sec())});return true;
 }
 if(raw==='/central/api/login'&&req.method==='POST'){
  if(!sameOrigin(req)){send(res,403,{error:'origem_nao_permitida'});return true;}
  const ip=String(req.socket.remoteAddress||'unknown').slice(0,80);
  if(!limit('login:'+ip,8)){send(res,429,{error:'tentativas_excedidas'});return true;}
  try{
   const input=await body(req,1600);
   if(!same(sec(),String(input.password||''))){send(res,401,{error:'acesso_nao_autorizado'});return true;}
   const stamp=String(Date.now()),session=stamp+'.'+signature(stamp);
   send(res,200,{ok:true},{'set-cookie':'horizon_session='+session+'; Path=/central; HttpOnly; Secure; SameSite=Strict; Max-Age=43200'});
  }catch{send(res,400,{error:'solicitacao_invalida'});}return true;
 }
 const publicRead=req.method==='GET'&&[
 '/central/api/overview','/central/api/agents','/central/api/tasks',
 '/central/api/usage','/central/api/history','/central/api/events','/central/api/repositories'
 ].includes(raw);
 if(!publicRead&&!authenticated(req)){send(res,401,{error:'autorizacao_necessaria'});return true;}
 if(raw==='/central/api/logout'&&req.method==='POST'){
  if(!sameOrigin(req)){send(res,403,{error:'origem_nao_permitida'});return true;}
  send(res,200,{ok:true},{'set-cookie':'horizon_session=; Path=/central; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});return true;
 }
 if(raw==='/central/api/events'&&req.method==='GET'){
  if(live.size>=25){send(res,503,{error:'limite_de_conexoes'});return true;}
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive','x-content-type-options':'nosniff'});
  res.write('retry: 5000\n\n');live.add(res);startLiveMonitor();
  const since=Number(req.headers['last-event-id']||new URL(req.url,'http://local').searchParams.get('since')||0);
  for(const event of events.filter(e=>e.id>since))res.write('id: '+event.id+'\nevent: update\ndata: '+JSON.stringify(event)+'\n\n');
  const ping=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},24000);
  req.on('close',()=>{clearInterval(ping);live.delete(res);stopLiveMonitorIfUnused();});return true;
 }
 if(req.method==='GET'&&raw==='/central/api/repositories'){
  try{const repositories=await ownerRepositories();send(res,200,{repositories,count:repositories.length});}
  catch{send(res,503,{error:'nao_foi_possivel_consultar_repositorios'});}return true;
 }
 if(req.method==='GET'&&['/central/api/overview','/central/api/agents','/central/api/tasks','/central/api/usage','/central/api/history'].includes(raw)){
  try{const overview=await loadOverview();
   const answer=raw.endsWith('/agents')?{agents:overview.agents,at:overview.at}:
    raw.endsWith('/tasks')?{tasks:overview.tasks,at:overview.at}:
    raw.endsWith('/usage')?{...overview.usage,at:overview.at}:
    raw.endsWith('/history')?{events:events.slice(-100),at:overview.at}:
    {...overview,events:events.slice(-25)};
   send(res,200,answer);
  }catch{send(res,503,{error:'dados_temporariamente_indisponiveis'});}return true;
 }
 if(req.method==='POST'&&raw==='/central/api/tasks'){
  if(!sameOrigin(req)){send(res,403,{error:'origem_nao_permitida'});return true;}
  try{const value=await body(req);const output=await createTask(value);send(res,201,output);}
  catch(e){send(res,400,{error:String(e?.message||'falha_de_envio').slice(0,100)});}return true;
 }
 if(req.method==='POST'&&raw==='/central/api/ai/interpret'){
  if(!sameOrigin(req)){send(res,403,{error:'origem_nao_permitida'});return true;}
  try{const output=await interpret(await body(req,2400));send(res,output.status,{response:output.response||null,error:output.error||null,usage:output.usage||null});}
  catch{send(res,502,{error:'provedor_indisponivel'});}return true;
 }
 send(res,404,{error:'rota_nao_encontrada'});return true;
}
