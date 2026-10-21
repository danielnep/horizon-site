import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileHandoffStore,reconcileHandoffs,registerHandoff,summarizeHandoffs} from '../maestro/handoff-store.mjs';

import assert from 'node:assert/strict';
import {ENGINEERING_METHODS,ENGINEERING_CONTEXT} from '../maestro/engineering.mjs';
import {MAESTRO} from '../maestro/identity.mjs';
import {CHECKPOINT_FRESH_MAX_AGE_MS,loadCheckpoint} from '../maestro/checkpoint.mjs';
import {normalizeDecision,toMayHandoff} from '../maestro/protocol.mjs';
import {startServer} from '../server.mjs';
const good={protocol_version:2,next_call_minutes:90,priority:'high',focus:'app-hondas-maxvel',
 next_may_task:'Inspecione erros de CI',acceptance_criteria:'Teste validado',why_this_time:'Janela para rodar os testes',
 context_summary:'Estado limitado',checkpoint_needed:['commit','resultado'],confidence:'limited-context'};
const checkpoint={schema_version:2,updated_at:'2026-10-17T14:00:00Z',
 last_execution:{id:'cycle-17',status:'verified',summary:'Teste realizado',verification:'commit',blocker:''},projects:[]};
test('identidade institucional e mesma tarefa',()=>{
 assert.equal(MAESTRO.existing_task_id,'6ad32bbba5488191aee18ef5fafd37b7');
 assert.match(MAESTRO.roles.gemini,/SUPERVISOR/);
});
test('rejeita modelos de respostas perigosos ou incorretos',()=>{
 assert.throws(()=>normalizeDecision({...good,next_call_minutes:1}),/60/);
 assert.throws(()=>normalizeDecision({...good,next_call_minutes:10081}),/10080/);
 assert.throws(()=>normalizeDecision({...good,priority:'bypass'}),/priority/);
 assert.throws(()=>normalizeDecision({...good,protocol_version:1}),/protocol_version/);
 assert.throws(()=>normalizeDecision({...good,next_may_task:''}),/next_may_task/);
});
test('le checkpoint e detecta dado velho',async()=>{
 const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
 assert.equal((await loadCheckpoint({fetcher,now:new Date('2026-10-17T14:05:00Z')})).status,'fresh');
 assert.equal((await loadCheckpoint({fetcher,now:new Date('2026-10-21T14:05:00Z')})).status,'stale');
});
test('limite de frescor: exatamente 6h fresh, apos 6h stale; caso real 18/10 nao pode ser fresh em 19/10',async()=>{
 const original='2026-10-18T19:41:35.193Z';
 const cp={...checkpoint,updated_at:original};
 const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(cp)});
 assert.equal(CHECKPOINT_FRESH_MAX_AGE_MS,6*3600000);
 const updated=Date.parse(original);
 const at=async ms=>loadCheckpoint({fetcher,now:new Date(updated+ms)});
 assert.equal((await at(CHECKPOINT_FRESH_MAX_AGE_MS)).status,'fresh');
 assert.equal((await at(CHECKPOINT_FRESH_MAX_AGE_MS+1000)).status,'stale');
 const observed=await loadCheckpoint({fetcher,now:new Date('2026-10-20T01:55:38.610Z')});
 assert.equal(observed.status,'stale');
 assert.equal(observed.readable,true);
 assert.equal(observed.ageMinutes,1814);
});

test('nao acessa checkpoint arbitrario',async()=>{
 const state=await loadCheckpoint({url:'https://evil.example/',fetcher:async()=>{throw Error('nao deveria chamar')}});
 assert.equal(state.status,'unavailable');
});
test('site e endpoints internos preservados',async()=>{
 const srv=startServer({listenPort:0,background:false,reader:async()=>Buffer.from('<html>Horizon</html>')});
 await new Promise(r=>srv.once('listening',r));const base='http://127.0.0.1:'+srv.address().port;
 try{assert.equal((await fetch(base+'/health')).status,200);
 assert.match(await(await fetch(base+'/')).text(),/Horizon/);
 assert.equal((await fetch(base+'/maestro-worker.mjs')).status,404);
 assert.equal((await fetch(base+'/maestro/checkpoint.json')).status,404);
 assert.equal((await fetch(base+'/maestro/metodos-engenharia-may.md')).status,404);
 }finally{await new Promise(r=>srv.close(r));}
});


test('checkpoint legivel de 26 horas e stale, sem comprovacao de execucao',async()=>{
 const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
 const status=await loadCheckpoint({fetcher,now:new Date('2026-10-18T16:05:00Z')});
 assert.equal(status.readable,true);
 assert.equal(status.status,'stale');
 assert.equal(status.ageMinutes,1565);
 const audit=summarizeHandoffs({version:1,handoffs:[]},status);
 assert.equal(audit.executionStatus,'unverified');
 assert.equal(audit.checkpointAgeMinutes,1565);
 assert.equal(audit.checkpointReadability,'readable');
});

test('handoff continua vencido apos reinicio e so reconhece recibo exato com evidencia',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-handoff-'));
 const file=join(dir,'receipts.json');
 const id='6fc0de12-34ab-4567-8901-1234567890ab';
 const issuedAt='2026-10-19T09:00:00Z';
 const dueAt='2026-10-19T10:30:00Z';
 try{
  const store=createFileHandoffStore({file});
  const state=registerHandoff(await store.read(),{
   decisionAt:issuedAt,nextCallAt:dueAt,checkpointExecutionId:'previous'
  },{id});
  await store.write(state);
  const afterRestart=createFileHandoffStore({file});
  const notConfirmed={...checkpoint,updated_at:'2026-10-19T10:01:00Z',
    last_execution:{...checkpoint.last_execution,id:'new-execution',verification:'tested'}};
  const missed=reconcileHandoffs(await afterRestart.read(),notConfirmed,new Date('2026-10-19T10:31:00Z'));
  assert.deepEqual(missed.changes,[{id,status:'overdue'}]);
  await afterRestart.write(missed.state);
  assert.equal((await store.read()).handoffs[0].status,'overdue');
  const withoutProof={...notConfirmed,last_execution:{...notConfirmed.last_execution,handoff_id:id,verification:''}};
  assert.equal(reconcileHandoffs(await store.read(),withoutProof,new Date('2026-10-19T10:32:00Z')).state.handoffs[0].status,'overdue');
  const withProof={...notConfirmed,updated_at:'2026-10-19T10:33:00Z',
    last_execution:{...notConfirmed.last_execution,handoff_id:id,verification:'sha verified'}};
  const confirmed=reconcileHandoffs(await store.read(),withProof,new Date('2026-10-19T10:34:00Z'));
  assert.equal(confirmed.state.handoffs[0].status,'acknowledged');
  await store.write(confirmed.state);
  assert.equal(summarizeHandoffs(await store.read(),{...statusFromCheckpoint(withProof)}).executionStatus,'acknowledged');
 }finally{await rm(dir,{recursive:true,force:true});}
});

function statusFromCheckpoint(cp){
 return {status:'fresh',readable:true,checkpoint:cp,ageMinutes:0};
}

test('estado corrompido bloqueia leitura e nao regrava silenciosamente',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-invalid-'));
 try{
  const file=join(dir,'receipts.json');
  await writeFile(file,'{invalid-json');
  await assert.rejects(()=>createFileHandoffStore({file}).read(),SyntaxError);
 }finally{await rm(dir,{recursive:true,force:true});}
});

