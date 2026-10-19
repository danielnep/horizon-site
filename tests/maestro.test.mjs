import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileHandoffStore,reconcileHandoffs,registerHandoff,summarizeHandoffs} from '../maestro/handoff-store.mjs';

import assert from 'node:assert/strict';
import {consultGemini,runSupervisorCycle,startScheduledReviewer} from '../maestro-worker.mjs';
import {ENGINEERING_METHODS,ENGINEERING_CONTEXT} from '../maestro/engineering.mjs';
import {MAESTRO} from '../maestro/identity.mjs';
import {loadCheckpoint} from '../maestro/checkpoint.mjs';
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
test('API valida chave e envia identidade e checkpoint',async()=>{
 const mock=async(_url,opts)=>{
  assert.equal(opts.headers['x-goog-api-key'],'teste');
  const p=JSON.parse(opts.body);
  assert.match(p.systemInstruction.parts[0].text,/SUPERVISOR/);
  assert.ok(p.systemInstruction.parts[0].text.includes(ENGINEERING_METHODS));
  assert.equal(JSON.parse(p.contents[0].parts[0].text.slice('CONTEXTO DE SUPERVISAO: '.length)).engineeringMethods.sha256,ENGINEERING_CONTEXT.sha256);
  assert.match(p.contents[0].parts[0].text,/cycle-17/);
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(good)}]}}]})};
 };
 const d=await consultGemini({apiKey:'teste',fetcher:mock,checkpoint,now:new Date('2026-10-17T14:00:00Z'),checkpointStatus:'fresh'});
 assert.equal(d.nextCallAt,'2026-10-17T15:30:00.000Z');
 assert.equal(toMayHandoff(d).taskId,MAESTRO.existing_task_id);
});
test('nao chama Gemini sem chave',async()=>{await assert.rejects(()=>consultGemini({apiKey:''}),/ausente/)});
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
test('nao acessa checkpoint arbitrario',async()=>{
 const state=await loadCheckpoint({url:'https://evil.example/',fetcher:async()=>{throw Error('nao deveria chamar')}});
 assert.equal(state.status,'unavailable');
});
test('traduz decisao em ordem para May nos logs',async()=>{
 const lines=[];
 const state=await runSupervisorCycle({fetcher:async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)}),
 gemini:async opts=>normalizeDecision(good,{now:opts.now,checkpoint:opts.checkpoint,checkpointStatus:opts.checkpointStatus}),
 clock:()=>new Date('2026-10-17T14:05:00Z'),log:s=>lines.push(s)});
 assert.equal(state.checkpointStatus,'fresh');
 assert.match(lines[0],/maestro-engineering-context/);
 assert.match(lines[0],new RegExp(ENGINEERING_CONTEXT.sha256));
 assert.match(lines[1],/maestro-supervisor/);assert.match(lines[2],/maestro-handoff/);
 assert.match(lines[2],/cycle-17/);
 assert.equal(state.handoff.engineeringMethods.sha256,ENGINEERING_CONTEXT.sha256);
});
test('indica ao Gemini falta de retorno da May',async()=>{
 const out=await runSupervisorCycle({fetcher:async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)}),
 previous:{checkpointExecutionId:'cycle-17'},staleCount:2,
 gemini:async opts=>{assert.equal(opts.staleCount,3);return normalizeDecision(good,{now:opts.now});},log:()=>{}});
 assert.equal(out.staleCount,3);
});
test('agenda a frequencia pedida e reconsulta com erro',async()=>{
 const delays=[],jobs=[];
 const stop=startScheduledReviewer({env:{MAESTRO_ENABLE_AUTO:'1'},run:async()=>({decision:normalizeDecision(good),checkpointStatus:'fresh',staleCount:0}),
 schedule:(fn,ms)=>{jobs.push(fn);delays.push(ms);return {unref(){}}},cancel:()=>{},log:()=>{}});
 await jobs[0]();assert.equal(delays[1],90*60000);stop();
 const fail=[],queue=[];
 const stop2=startScheduledReviewer({env:{MAESTRO_ENABLE_AUTO:'1'},run:async()=>{throw Error('offline')},
 schedule:(fn,ms)=>{queue.push(fn);fail.push(ms);return {unref(){}}},cancel:()=>{},log:()=>{}});
 await queue[0]();assert.equal(fail[1],600000);stop2();
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


test('fresh de 26 horas indica legibilidade, nao execucao comprovada',async()=>{
 const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
 const status=await loadCheckpoint({fetcher,now:new Date('2026-10-18T16:05:00Z')});
 assert.equal(status.readable,true);
 assert.equal(status.status,'fresh');
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

test('supervisor publica recibo somente apos escrita duravel e sinaliza atraso',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-cycle-'));
 try{
  const store=createFileHandoffStore({file:join(dir,'state.json')});
  const now1=new Date('2026-10-19T09:00:00Z');
  const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
  const gemini=async ({now,checkpoint:cp,checkpointStatus})=>normalizeDecision(good,{now,checkpoint:cp,checkpointStatus});
  const logs=[];
  const first=await runSupervisorCycle({fetcher,gemini,clock:()=>now1,handoffStore:store,log:x=>logs.push(x)});
  assert.equal(first.decision.persistenceStatus,'persisted');
  assert.equal(first.decision.executionStatus,'unverified');
  assert.equal((await store.read()).handoffs.length,1);
  assert.equal(first.handoff.handoffId,first.decision.handoffId);
  const second=await runSupervisorCycle({fetcher,gemini,clock:()=>new Date('2026-10-19T10:31:00Z'),
   handoffStore:store,log:x=>logs.push(x)});
  assert.equal(second.decision.executionStatus,'overdue');
  assert.equal(second.decision.overdueHandoffs,1);
  assert.equal(second.decision.pendingHandoffs,0);
  assert.equal((await store.read()).handoffs.length,2);
  assert.ok(logs.some(x=>x.startsWith('[maestro-handoff-alert] ')));
  assert.equal(second.handoff.executionStatus,'overdue');
  assert.equal(second.handoff.checkpointReadability,'readable');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('falha de persistencia impede publicar handoff ou marcar sucesso',async()=>{
 const logs=[];
 const store={read:async()=>({version:1,handoffs:[]}),write:async()=>{throw Error('ENOSPC');}};
 const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
 const gemini=async ({now,checkpoint:cp,checkpointStatus})=>normalizeDecision(good,{now,checkpoint:cp,checkpointStatus});
 await assert.rejects(()=>runSupervisorCycle({fetcher,gemini,clock:()=>new Date('2026-10-19T09:00:00Z'),
   handoffStore:store,log:x=>logs.push(x)}),/ENOSPC/);
 assert.equal(logs.some(x=>x.startsWith('[maestro-handoff] ')),false);
});


test('persiste auditoria antes de Gemini 429 e DeepSeek 402, sem declarar handoff',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-audit-offline-'));
 try{
  const file=join(dir,'state.json');
  const store=createFileHandoffStore({file});
  const logs=[];
  const now=new Date('2026-10-18T16:05:00Z');
  const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
  const gemini=async()=>{throw Error('Supervisor indisponivel: Gemini HTTP 429; DeepSeek HTTP 402');};
  await assert.rejects(()=>runSupervisorCycle({fetcher,gemini,clock:()=>now,
    handoffStore:store,log:x=>logs.push(x)}),/Gemini HTTP 429/);
  const restored=await createFileHandoffStore({file}).read();
  assert.equal(restored.lastObservation.checkedAt,now.toISOString());
  assert.equal(restored.lastObservation.checkpointAgeMinutes,1565);
  assert.equal(restored.lastObservation.executionStatus,'unverified');
  assert.deepEqual(restored.handoffs,[]);
  assert.equal(logs.filter(x=>x.startsWith('[maestro-checkpoint-audit] ')).length,1);
  assert.equal(logs.some(x=>x.startsWith('[maestro-handoff] ')),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('auditoria preserva observacao e handoffs existentes entre ciclos',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-audit-retain-'));
 try{
  const store=createFileHandoffStore({file:join(dir,'state.json')});
  const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)});
  const gemini=async({now,checkpoint:cp,checkpointStatus})=>normalizeDecision(good,{now,checkpoint:cp,checkpointStatus});
  await runSupervisorCycle({fetcher,gemini,clock:()=>new Date('2026-10-18T16:05:00Z'),handoffStore:store,log:()=>{}});
  let state=await store.read();
  assert.equal(state.handoffs.length,1);
  assert.equal(state.lastObservation.executionStatus,'unverified');
  await assert.rejects(()=>runSupervisorCycle({fetcher,gemini:async()=>{throw Error('quota');},
   clock:()=>new Date('2026-10-18T17:40:00Z'),handoffStore:store,log:()=>{}}),/quota/);
  state=await createFileHandoffStore({file:store.file}).read();
  assert.equal(state.handoffs.length,1);
  assert.equal(state.handoffs[0].status,'overdue');
  assert.equal(state.lastObservation.executionStatus,'overdue');
  assert.equal(state.lastObservation.pendingHandoffs,0);
  assert.equal(state.lastObservation.overdueHandoffs,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
