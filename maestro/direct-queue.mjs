// Railway-local durable owner inbox. GitHub is never the task transport.
import {randomUUID} from 'node:crypto';
import {mkdir,open,link,unlink,readFile,readdir,lstat} from 'node:fs/promises';
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
 for(const p of [root,join(root,'requests'),join(root,'results')]){
  await mkdir(p,{recursive:true,mode:0o700});
  const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink())throw Error('diretorio_unsafe');
 }
 return root;
}
export async function submitDirectTask(value){
 const request=validated(value);
 const root=await ensure(),id=request.task_id;
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
export async function directTasks(){
 const root=await ensure();
 const names=await readdir(join(root,'requests'));
 if(names.length>120)throw Error('fila_oversized');
 const tasks=[];
 for(const name of names.sort()){
  if(!name.endsWith('.json'))continue;
  if(!ID.test(name.slice(0,-5)))throw Error('fila_invalida');
  const [raw,result]=await Promise.all([
    readFile(join(root,'requests',name),'utf8'),
    readFile(join(root,'results',name),'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e))
  ]);
  const task=JSON.parse(raw);
  const outcome=result?JSON.parse(result):null;
  const stages=Array.isArray(outcome?.tasks)?outcome.tasks:[];
  const rawStatus=outcome?.status||'pending';
  const finished=['completed','done','succeeded','reported_complete'].includes(rawStatus);
  const status=finished?(outcome?.quality?.approved===true&&outcome?.publication?.published===true?
    'concluída':'aguardando validação'):
    /fail|error|block|reject/.test(rawStatus)?'bloqueada':
    /running|in_progress/.test(rawStatus)?'em execução':'na fila';
  tasks.push({id:task.task_id,project:task.project,repository:task.repository,
   agent:task.agent,title:String(task.objective).slice(0,180),inQueue:true,
   status,rawStatus,hasResult:!!outcome,
   stages:stages.map(x=>({agent:x.agent,state:x.status,summary:x.summary||null,
    blocker:x.blocker||null})),
   approved:outcome?.quality?.approved===true,
   published:outcome?.publication?.published===true,
   updatedAt:outcome?.updated_at||null,
   progress:stages.length?{total:stages.length,done:stages.filter(x=>
     ['succeeded','completed','failed','blocked'].includes(x.status)).length,
     verified:stages.filter(x=>x.quality?.approved===true).length}:null});
 }
 return tasks;
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
