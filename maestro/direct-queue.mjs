// Railway-local durable owner inbox. GitHub is never the task transport.
import {randomUUID} from 'node:crypto';
import {mkdir,open,link,unlink,readFile,readdir,lstat,appendFile,rename,utimes} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const ID=/^[a-z0-9][a-z0-9-]{2,69}$/;
const REPO=/^danielnep\/[a-zA-Z0-9_.-]+$/;
const PATH=/^[a-zA-Z0-9_./*?-]{1,300}$/;
const AGENTS=new Set([
 'may-maestro','horizon-project-studio','software-architect','frontend-engineer',
 'backend-engineer','mobile-app-builder','ui-ux-designer','horizon-ui-guardian',
 'database-engineer','integration-engineer','qa-engineer','security-engineer',
 'devops-engineer','horizon-evolution-agent','horizon-skills','corregedoria-may','may-persona'
]);
export const directRoot=()=>resolve(process.env.HORIZON_DIRECT_INBOX_DIR||'/data/horizon-direct-queue');

function validatePath(value,repo){
 if(typeof value!=='string'||!PATH.test(value)||value.startsWith('/')||
    value.includes('\\')||value.includes('//')||value.split('/').some(s=>
     !s||s==='.'||s==='..'||s.startsWith('.')||/^(secrets|credentials|runtime|node_modules|__pycache__)$/i.test(s)||
     /(^|[_.-])(tokens?|secrets?|credentials?|passwords?|private.?key)([_.-]|$)/i.test(s))||
    /\.(pem|key|sqlite3?|db|jks|keystore|env)$/i.test(value)||
    /[*?\[]/.test(value.split('/')[0]))return false;
 const deny=new Set(['agents','horizon_core','sandbox','android_tools','maestro_exec','executors',
   'supervisor.py','GEMINI.md','AGENTS.md']);
 if(repo==='danielnep/May-Maestro-Executor')for(const s of ['tasks','tests','android','chat_bridge','benchmarks'])deny.add(s);
 return !deny.has(value.split('/')[0]);
}
function validated(v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('dados_da_tarefa_invalidos');
 const id=v.task_id??('ctl-'+Date.now().toString(36)+'-'+randomUUID().slice(0,8));
 const project=String(v.project||'').toLowerCase();
 const objective=String(v.objective||'').trim();
 const repository=String(v.repository||'danielnep/May-Maestro-Executor');
 const agent=v.agent||'may-maestro';
 const delivery_type=v.delivery_type||'existing_product';
 const paths=v.allowed_paths;
 const priority=v.priority||'P2';
 if(!ID.test(id)||!ID.test(project)||!REPO.test(repository)||
    !AGENTS.has(agent)||!/^P[0-3]$/.test(priority)||
    !['existing_product','new_product'].includes(delivery_type)||
    objective.length<12||objective.length>12000||
    v.public_data_confirmed!==true)throw Error('dados_da_tarefa_invalidos');
 if(!Array.isArray(paths)||paths.length>25||
    (delivery_type==='existing_product'&&!paths.length)||
    paths.some(p=>!validatePath(p,repository))||new Set(paths).size!==paths.length)
    throw Error('caminhos_nao_autorizados');
 const scope=delivery_type==='new_product' ? ['apps/'+project+'/**'] : paths;
 if(scope.some(p=>!validatePath(p,repository)))throw Error('caminhos_nao_autorizados');
 const text=/^P[0-3]\b/.test(objective)?objective:(priority+' | '+objective);
 return {owner:'danielnep',repository,task_id:id,agent,project,
  objective:text,delivery_type,payload:{allowed_paths:scope}};
}
async function ensure(){
 const root=directRoot();
 for(const p of [root,join(root,'requests'),join(root,'results'),join(root,'paused'),join(root,'cancelled'),join(root,'archived'),join(root,'agent-holds')]){
  await mkdir(p,{recursive:true,mode:0o700});
  const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink())throw Error('diretorio_unsafe');
 }
 return root;
}
export async function submitDirectTask(value){
 const request=validated(value);
 const root=await ensure(),id=request.task_id;
 try{await lstat(join(root,'agent-holds',request.agent+'.json'));throw Error('agente_tem_novas_tarefas_pausadas');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const target=join(root,'requests',id+'.json');
 const bytes=JSON.stringify(request,null,2)+'\n';
 if(Buffer.byteLength(bytes)>65536)throw Error('tarefa_grande_demais');
 const staging=join(root,'requests','.'+id+'.'+randomUUID()+'.tmp');
 let fd;
 try{
  fd=await open(staging,'wx',0o600);
  await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
  try{await link(staging,target);}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const current=await readFile(target,'utf8');
   if(current!==bytes)throw Error('task_id_ja_existe');
   return {id,status:'aceita_previamente',transport:'railway_local',wake:'sem_duplicacao'};
  }
  const dir=await open(join(root,'requests'),'r');
  try{await dir.sync();}finally{await dir.close();}
  return {id,status:'aceita',transport:'railway_local',wake:'proximo_ciclo_imediato'};
 }finally{
  if(fd)await fd.close();
  await unlink(staging).catch(()=>{});
 }
}
// The order file is metadata, not a second request transport. The executor uses
// it to choose the next Railway-local task; unknown IDs are discarded.
async function queueOrder(root){
 const names=(await readdir(join(root,'requests'))).filter(n=>n.endsWith('.json')&&ID.test(n.slice(0,-5))).map(n=>n.slice(0,-5)).sort();
 let stored=[];
 try{
  const data=JSON.parse(await readFile(join(root,'queue-order.json'),'utf8'));
  if(Array.isArray(data)&&data.length<=160)stored=data.filter(id=>typeof id==='string'&&ID.test(id));
 }catch(e){if(e.code!=='ENOENT')throw Error('ordem_da_fila_invalida');}
 const eligible=new Set(names);
 return [...new Set([...stored.filter(id=>eligible.has(id)),...names])];
}
async function saveQueueOrder(root,ids){
 const staging=join(root,'.queue-order-'+randomUUID()+'.tmp');
 const fd=await open(staging,'wx',0o600);
 try{await fd.writeFile(JSON.stringify(ids)+'\n');await fd.sync();}
 finally{await fd.close();}
 try{await rename(staging,join(root,'queue-order.json'));}
 finally{await unlink(staging).catch(()=>{});}
}
async function audit(root,taskId,action,detail={}){
 await appendFile(join(root,'control-actions.jsonl'),JSON.stringify({taskId,action,at:new Date().toISOString(),...detail})+'\n',{mode:0o600});
}
export async function directTasks({includeArchived=false}={}){

 const root=await ensure();
 const order=await queueOrder(root),positions=new Map(order.map((id,index)=>[id,index]));
 const groups=await Promise.all(['requests','paused','cancelled',...(includeArchived?['archived']:[])].map(async state=>({state,names:await readdir(join(root,state))})));
 if(groups.reduce((n,x)=>n+x.names.length,0)>160)throw Error('fila_oversized');
 const tasks=[];
 for(const group of groups){
 for(const name of group.names.sort()){
  if(!name.endsWith('.json'))continue;
  if(!ID.test(name.slice(0,-5)))throw Error('fila_invalida');
  const [raw,result]=await Promise.all([
    readFile(join(root,group.state,name),'utf8'),
    readFile(join(root,'results',name),'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e))
  ]);
  const task=JSON.parse(raw);
  const outcome=result?JSON.parse(result):null;
  const stages=Array.isArray(outcome?.tasks)?outcome.tasks:[];
  const rawStatus=outcome?.status||'pending';
  const supervision=outcome?.supervision&&typeof outcome.supervision==='object'?
    outcome.supervision:null;
  const waitReason=String(supervision?.reason||'');
  const waiting=['scheduled_retry','waiting_for_dependencies','being_executed',
    'lease_expired'].includes(waitReason);
  const finished=['completed','done','succeeded','reported_complete'].includes(rawStatus);
  const status=finished?(outcome?.quality?.approved===true&&outcome?.publication?.published===true?
    'concluída':'aguardando validação'):
    /fail|error|block|reject/.test(rawStatus)?'bloqueada':
    /running|in_progress/.test(rawStatus)?'em execução':waiting?'aguardando':'na fila';
  tasks.push({id:task.task_id,project:task.project,repository:task.repository,
   agent:task.agent,priority:/^P[0-3]\b/.exec(String(task.objective))?.[0]||'P2',queuePosition:positions.has(task.task_id)?positions.get(task.task_id)+1:null,title:String(task.objective).slice(0,120),description:String(task.objective).slice(0,2800),inQueue:group.state==='requests',
   status:group.state==='paused'?'pausada':group.state==='cancelled'?'cancelada':group.state==='archived'?'arquivada':status,
   rawStatus,hasResult:!!outcome,
   stages:stages.map(x=>({taskId:x.task_id||null,agent:x.agent,state:x.status,
    summary:x.summary||null,blocker:x.blocker||null,
    waitReason:x.wait_reason||null,retryReason:x.retry_reason||null,
    nextRetryAt:x.next_retry_at||null,blockedBy:Array.isArray(x.blocked_by)?x.blocked_by.slice(0,17):[],
    attempts:Number.isInteger(x.attempts)?x.attempts:0,
    maxAttempts:Number.isInteger(x.max_attempts)?x.max_attempts:null,
    checkpointStep:Number.isInteger(x.checkpoint_step)?x.checkpoint_step:null})),
   supervision:supervision?{
    reason:waitReason,firstPendingTask:supervision.first_pending_task||null,
    firstPendingAgent:supervision.first_pending_agent||null,
    blockedBy:Array.isArray(supervision.blocked_by)?supervision.blocked_by.slice(0,17):[],
    retryReason:supervision.retry_reason||null,nextRetryAt:supervision.next_retry_at||null,
    checkedAt:supervision.checked_at||null}:null,
   approved:outcome?.quality?.approved===true,
   published:outcome?.publication?.published===true,
   updatedAt:outcome?.updated_at||null,
   progress:stages.length?{total:stages.length,done:stages.filter(x=>
     ['succeeded','completed'].includes(x.status)).length,
     verified:stages.filter(x=>x.quality?.approved===true).length}:null});
 }
 }
 return tasks.sort((a,b)=>a.inQueue&&b.inQueue?(a.queuePosition??999)-(b.queuePosition??999):a.inQueue?-1:b.inQueue?1:0);
}

export async function directTaskAction(taskId,action,options={}){

 if(!ID.test(taskId)||!['pause','cancel','resume','archive','restore','up','down','move','assign','priority','edit'].includes(action))throw Error('comando_invalido');
 const root=await ensure();
 const name=taskId+'.json';
 let state;
 for(const dir of ['requests','paused','cancelled','archived']){
  const path=join(root,dir,name);
  try{const file=await lstat(path);if(file.isFile()&&!file.isSymbolicLink()){state=dir;break;}}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(!state)throw Error('tarefa_nao_encontrada_no_railway');
 if(['up','down','move'].includes(action)){
  if(state!=='requests')throw Error('tarefa_fora_da_fila');
  const order=await queueOrder(root),index=order.indexOf(taskId);
  const next=action==='move'?Number(options.position)-1:index+(action==='up'?-1:1);
  if(action==='move'&&(!Number.isInteger(next)||next<0||next>=order.length))throw Error('posicao_invalida');
  if(index<0||next<0||next>=order.length)return {id:taskId,status:'na fila',already:true};
  if(action==='move'){order.splice(index,1);order.splice(next,0,taskId);}
  else [order[index],order[next]]=[order[next],order[index]];
  await saveQueueOrder(root,order);
  // Wake the current worker even if only the order metadata changed.
  const now=new Date();await utimes(join(root,'requests',name),now,now);
  await audit(root,taskId,action,{position:next+1});
  return {id:taskId,status:'na fila',queuePosition:next+1,note:'Ordem de execução atualizada na fila do Railway.'};
 }
 if(['assign','priority','edit'].includes(action)){
  if(state!=='requests'&&state!=='paused')throw Error('tarefa_nao_editavel');
  try{await lstat(join(root,'results',name));throw Error('tarefa_ja_iniciada');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const path=join(root,state,name),input=JSON.parse(await readFile(path,'utf8'));
  if(action==='assign'){
   if(!AGENTS.has(options.agent))throw Error('agente_invalido');
   try{await lstat(join(root,'agent-holds',options.agent+'.json'));throw Error('agente_pausado');}
   catch(e){if(e.code!=='ENOENT')throw e;}
   input.agent=options.agent;
  }else if(action==='edit'){
   const objective=String(options.objective||'').trim();
   if(objective.length<12||objective.length>2800)throw Error('objetivo_invalido');
   const prefix=/^P[0-3]\s*\|\s*/.exec(String(input.objective))?.[0]||'P2 | ';
   input.objective=prefix+objective.replace(/^P[0-3]\s*\|\s*/,'');
  }else{
   if(!/^P[0-3]$/.test(options.priority||''))throw Error('prioridade_invalida');
   input.objective=options.priority+' | '+String(input.objective).replace(/^P[0-3]\s*\|\s*/,'');
  }
  const staging=join(root,state,'.'+taskId+'.'+randomUUID()+'.tmp');
  const fd=await open(staging,'wx',0o600);
  try{await fd.writeFile(JSON.stringify(input,null,2)+'\n');await fd.sync();}
  finally{await fd.close();}
  try{await rename(staging,path);}
  finally{await unlink(staging).catch(()=>{});}
  await audit(root,taskId,action,{value:action==='assign'?input.agent:action==='edit'?'updated':options.priority});
  return {id:taskId,status:state==='requests'?'na fila':'pausada',note:'Alteração registrada na solicitação durável.'};
 }
 const target=action==='pause'?'paused':action==='cancel'?'cancelled':action==='archive'?'archived':action==='restore'?'paused':'requests';
 if(action==='archive'&&state==='archived')return {id:taskId,status:'arquivada',already:true};
 if(action==='restore'&&state!=='archived')throw Error('tarefa_nao_arquivada');
 if(state==='archived'&&action!=='restore')throw Error('tarefa_arquivada');
 if(action==='resume'&&state==='requests')throw Error('tarefa_ja_esta_na_fila');
 if(action==='pause'&&state!=='requests')throw Error('so_pode_pausar_uma_tarefa_na_fila');
 if(action==='resume'&&state!=='paused'&&state!=='cancelled')throw Error('tarefa_nao_estava_suspensa');
 if(state===target)return {id:taskId,status:state,already:true};
 const sourcePath=join(root,state,name),targetPath=join(root,target,name);
 try{await link(sourcePath,targetPath);}
 catch(e){if(e.code==='EEXIST')throw Error('tarefa_duplicada_no_destino');throw e;}
 try{await unlink(sourcePath);}
 catch(e){await unlink(targetPath).catch(()=>{});throw e;}
 await audit(root,taskId,action,{note:'Comando aplicado à fila local; não interrompe processos já carregados pelo executor.'});
 return {id:taskId,status:target==='requests'?'na fila':target==='paused'?'pausada':target==='archived'?'arquivada':'cancelada',
  note:'Aplicado na fila do Railway. Se o agente já estava executando, essa etapa pode continuar até encerrar.'};
}


export async function agentHolds(){
 const root=await ensure(),names=await readdir(join(root,'agent-holds'));
 return names.filter(name=>name.endsWith('.json')&&AGENTS.has(name.slice(0,-5))).map(name=>name.slice(0,-5));
}
export async function directAgentAction(agent,action){
 if(!AGENTS.has(agent)||!['pause','resume'].includes(action))throw Error('comando_invalido');
 const root=await ensure();
 const file=join(root,'agent-holds',agent+'.json');
 if(action==='pause'){
  try{
   const fd=await open(file,'wx',0o600);
   try{await fd.writeFile(JSON.stringify({agent,pausedAt:new Date().toISOString()})+'\n');await fd.sync();}
   finally{await fd.close();}
  }catch(e){if(e.code!=='EEXIST')throw e;}
 }else{
  await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
 }
 const tasks=await directTasks();
 let moved=0;
 for(const t of tasks){
  if(t.agent!==agent)continue;
  if(action==='pause'&&!t.inQueue)continue;
  if(action==='resume'&&t.status!=='pausada')continue;
  try{await directTaskAction(t.id,action==='pause'?'pause':'resume');moved++;}
  catch(e){if(!/ja_esta|nao_estava|so_pode/.test(e.message))throw e;}
 }
 return {agent,status:action==='pause'?'novas tarefas suspensas':'novas tarefas liberadas',
  affected:moved,note:'Este comando controla novas tarefas no Railway. Um processamento já iniciado pode continuar até terminar.'};
}

export async function directStatus(taskId){
 if(!ID.test(taskId))throw Error('task_id_invalido');
 const root=await ensure();
 const [request,result]=await Promise.all([
  readFile(join(root,'requests',taskId+'.json'),'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e)),
  readFile(join(root,'results',taskId+'.json'),'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e))
 ]);
 if(!request)return {task_id:taskId,status:'not_found'};
 return {task_id:taskId,status:result?'reported':'accepted',result:result?JSON.parse(result):null};
}
