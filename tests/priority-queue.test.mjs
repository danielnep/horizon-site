import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPriorityQueue,enforceQueuePriority,selectHighestPriority} from '../maestro/priority-queue.mjs';
import {normalizeDecision} from '../maestro/protocol.mjs';

const p0id='a-ronda-pro-auditoria-total-20261019';
const oldid='a-ronda-pro-mobile-field-20261019';
const repo='danielnep/app-hondas-maxvel';
const checkpoint={schema_version:2,updated_at:'2026-10-18T19:41:35.193Z',
 last_execution:{id:'may-maestro-romaneio-ci-main-pr2-20261018',status:'implemented-tested-pr-ready',
 summary:'PR 2 do Romaneio',verification:'CI passou'},projects:[]};
const romaneio={protocol_version:2,next_call_minutes:180,priority:'high',focus:'danielnep/romaneio-digital',
 next_may_task:'Revisar PR 2 do Romaneio',acceptance_criteria:'Verificar CI',why_this_time:'PR pendente',
 context_summary:'Checkpoint registrou Romaneio',checkpoint_needed:[],confidence:'grounded'};

function task(id,objective,repository=repo){
 return {task_id:id,repository,objective};
}
function response(data,status=200){
 return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)};
}
function stubQueueFetch({resolutions={}}={}){
 const chats={
  [p0id]:task(p0id,'MISSÃO P0 EXTREMAMENTE URGENTE, PROPRIETÁRIO: Ronda Pro completo'),
  [oldid]:task(oldid,'P0 ABSOLUTA, INICIAR AGORA: mobile Vigia e Vistoriador'),
  'michelle':task('michelle','MISSÃO PRIORITÁRIA, Painel Michelle','danielnep/michelle-preview')
 };
 const list=Object.keys(chats).map(id=>({type:'file',name:id+'.json'}));
 return async(url)=>{
  if(url.includes('/contents/tasks/chat?'))return response(list);
  for(const [id,item] of Object.entries(chats)){
   if(url.endsWith('/chat/'+id+'.json'))return response(item);
   if(url.endsWith('/results/'+id+'.json'))
    return id in resolutions?response(resolutions[id]):response({},404);
  }
  throw Error('Unexpected URL: '+url);
 };
}
const now=new Date('2026-10-20T00:28:07.231Z');
test('reads the actual owner P0 task even if inbox is empty and checkpoint mentions Romaneio',async()=>{
 const queue=await loadPriorityQueue({fetcher:stubQueueFetch(),now});
 assert.equal(queue.status,'verified');
 assert.equal(queue.highest.id,p0id);
 assert.equal(queue.highest.priority,'P0');
 assert.equal(queue.tasks.length,2);
 assert.ok(queue.highest.source.includes('/tasks/chat/'+p0id+'.json'));
});
test('does not resolve P0 just because an agent reports succeeded or publication awaits approval',async()=>{
 const queue=await loadPriorityQueue({fetcher:stubQueueFetch({resolutions:{
  [p0id]:{status:'succeeded',quality:{approved:false},publication:{published:false}}
 }})});
 assert.equal(queue.highest.id,p0id);
 const completed=await loadPriorityQueue({fetcher:stubQueueFetch({resolutions:{
  [p0id]:{status:'completed',quality:{approved:true},publication:{published:true}},
  [oldid]:{status:'pending'}
 }})});
 assert.equal(completed.highest.id,oldid);
});
test('deterministic guard prevents a Gemini Romaneio PR decision while Ronda P0 exists',async()=>{
 const queue=await loadPriorityQueue({fetcher:stubQueueFetch(),now});
 const previous=normalizeDecision(romaneio,{now,checkpoint});
 const selected=enforceQueuePriority(previous,queue);
 assert.equal(selected.focus,repo);
 assert.equal(selected.priority,'critical');
 assert.equal(selected.queueTaskId,p0id);
 assert.equal(selected.nextCallMinutes,60);
 assert.equal(selected.nextCallAt,'2026-10-20T01:28:07.231Z');
 assert.match(selected.nextMayTask,new RegExp(p0id));
 assert.equal(selected.selectionPolicy,'mandatory-priority-override');
});
test('matching P0 task keeps Gemini details and corrects critical priority',async()=>{
 const queue=await loadPriorityQueue({fetcher:stubQueueFetch(),now});
 const same=normalizeDecision({...romaneio,focus:repo,next_may_task:'Trabalhar em '+p0id},{now});
 const out=enforceQueuePriority(same,queue);
 assert.equal(out.selectionPolicy,'model-respected-priority');
 assert.equal(out.nextMayTask,'Trabalhar em '+p0id);
 assert.equal(out.priority,'critical');
});
test('load errors fail closed rather than treating an unreadable registry as empty',async()=>{
 await assert.rejects(()=>loadPriorityQueue({fetcher:async()=>response('rate limit',429)}),/HTTP 429/);
 assert.throws(()=>enforceQueuePriority(normalizeDecision(romaneio,{now}),{status:'unavailable'}),/unavailable/);
 assert.equal(selectHighestPriority([{id:'a',priority:'P1',resolved:false},{id:'b',priority:'P0',resolved:true}]).id,'a');
});
