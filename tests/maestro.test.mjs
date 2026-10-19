import {test} from 'node:test';
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
