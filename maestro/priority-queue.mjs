// Public, read-only priority inventory. The executor's task files are the source
// of explicit owner priorities; May's historical checkpoint is not a work queue.
const BASE='https://raw.githubusercontent.com/danielnep/May-Maestro-Executor/main/tasks';
const CHAT_DIR='https://api.github.com/repos/danielnep/May-Maestro-Executor/contents/tasks/chat?ref=main';
const FILE=/^[a-z0-9][a-z0-9._-]{0,159}\.json$/i;
const MAX_FILES=100,MAX_BYTES=60000;

async function getJson(fetcher,url,{missing=false}={}){
 const response=await fetcher(url,{headers:{'Accept':'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
 if(missing&&response.status===404)return null;
 if(!response.ok)throw Error('GitHub queue HTTP '+response.status);
 const body=await response.text();
 if(Buffer.byteLength(body)>MAX_BYTES)throw Error('GitHub queue document too large');
 return JSON.parse(body);
}

function explicitPriority(chat){
 if(typeof chat.priority==='string'&&/^P[0-3]$/i.test(chat.priority.trim()))return chat.priority.trim().toUpperCase();
 // Legacy task contracts encode explicit priority in the first paragraph.
 const opening=[chat.objective,chat.initiative_reason].filter(x=>typeof x==='string')
  .map(x=>x.slice(0,220)).join(' ');
 const match=opening.match(/(?:^|[^\p{L}\p{N}])P([0-3])(?:$|[^\p{L}\p{N}])/iu);
 return match?'P'+match[1]:null;
}
function isResolved(result){
 if(!result||typeof result!=='object')return false;
 return ['completed','done','succeeded'].includes(result.status)&&
  result.quality?.approved===true&&result.publication?.published===true;
}

export function selectHighestPriority(tasks){
 const active=tasks.filter(x=>!x.resolved&&/^P[0-3]$/.test(x.priority));
 // Stable tie-break: explicit owner's P0 first, then the task identifier.
 active.sort((a,b)=>Number(a.priority[1])-Number(b.priority[1])||a.id.localeCompare(b.id));
 return active[0]||null;
}

export async function loadPriorityQueue({fetcher=fetch,now=new Date()}={}){
 const files=await getJson(fetcher,CHAT_DIR);
 if(!Array.isArray(files)||files.length>MAX_FILES)throw Error('GitHub queue listing unavailable or oversized');
 const names=files.filter(x=>x?.type==='file'&&typeof x.name==='string'&&FILE.test(x.name))
  .map(x=>x.name);
 if(names.length!==files.filter(x=>x?.type==='file'&&String(x.name).endsWith('.json')).length)
  throw Error('GitHub queue filename invalid');
 const tasks=[];
 // A bounded sequential read avoids bursts against GitHub's public API.
 for(const name of names){
  const chat=await getJson(fetcher,BASE+'/chat/'+name);
  if(!chat||typeof chat!=='object'||Array.isArray(chat))throw Error('Invalid task contract: '+name);
  const id=name.slice(0,-5);
  if(chat.task_id!==id||typeof chat.repository!=='string'||
     !/^danielnep\/[a-z0-9._-]+$/i.test(chat.repository))throw Error('Invalid task identity: '+name);
  const priority=explicitPriority(chat);
  if(!priority)continue;
  const result=await getJson(fetcher,BASE+'/results/'+name,{missing:true});
  tasks.push({id,repo:chat.repository,priority,
   status:typeof result?.status==='string'?result.status:'unreported',
   resolved:isResolved(result),
   source:'https://github.com/danielnep/May-Maestro-Executor/blob/main/tasks/chat/'+name,
   objectiveExcerpt:String(chat.objective||'').slice(0,180)});
 }
 const highest=selectHighestPriority(tasks);
 return {status:'verified',checkedAt:now.toISOString(),source:CHAT_DIR,totalTasks:files.length,
  tasks,highest};
}

export function enforceQueuePriority(decision,queue){
 if(queue?.status!=='verified')throw Error('Priority queue unavailable: refusing unverified selection');
 const task=queue.highest;
 if(!task)return {...decision,queueStatus:'verified',queueTaskId:null,selectionPolicy:'model-no-explicit-priority'};
 const targetPriority={P0:'critical',P1:'high',P2:'normal',P3:'low'}[task.priority];
 const matches=decision.focus===task.repo&&decision.nextMayTask.includes(task.id);
 const forced=!matches;
 const maxMinutes=task.priority==='P0'?60:task.priority==='P1'?120:decision.nextCallMinutes;
 const minutes=Math.min(decision.nextCallMinutes,maxMinutes);
 return {...decision,
  priority:targetPriority,
  ...(forced?{
   focus:task.repo,
   nextMayTask:'Priorizar '+task.priority+' '+task.id+'. Ler missão integral em '+task.source+
    ' e retomar execução ou desbloqueio com evidências, sem substituir por PRs de outro projeto.',
   acceptanceCriteria:'Registrar estado real, responsável, branch, evidências de execução/teste e bloqueios de '+task.id+'. Não declarar conclusão sem QA verificável.',
   whyThisTime:'Prioridade '+task.priority+' explícita do proprietário na fila ativa; checkpoint anterior não pode reordená-la.',
   contextSummary:'Fila verificada: '+task.id+' ('+task.priority+', '+task.status+'). Histórico do checkpoint não determina prioridade.',
  }:{}),
  nextCallMinutes:minutes,
  nextCallAt:new Date(new Date(decision.decisionAt).getTime()+minutes*60000).toISOString(),
  queueStatus:'verified',queueTaskId:task.id,queuePriority:task.priority,queueSource:task.source,
  selectionPolicy:forced?'mandatory-priority-override':'model-respected-priority'};
}
