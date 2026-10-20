import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consultWithFallback,consultDeepSeek,runSupervisorCycle} from '../maestro-worker.mjs';
import {requestMayBrowserDecision,consultationTicket,publicConsultation} from '../maestro/may-browser-fallback.mjs';

const decision={protocol_version:2,next_call_minutes:60,priority:'high',
 focus:'danielnep/michelle-preview',next_may_task:'Retomar a entrega do Painel Michelle',
 acceptance_criteria:'Commits e testes reais',why_this_time:'Cliente aguardando entrega',
 context_summary:'Recuperar checkpoint atual',checkpoint_needed:['commit','testes'],
 confidence:'limited-context'};
const now=new Date('2026-10-19T03:00:00Z');
const ok=()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(decision)}}]})});
function args(fetcher,log=()=>{}) {
 return {apiKey:'gemini-test',deepSeekKey:'deepseek-test',deepSeekModel:'deepseek-chat',
   now,fetcher,log,checkpointStatus:'fresh',checkpoint:null};
}
test('Gemini 429 executa fallback DeepSeek na MESMA chamada',async()=>{
 const calls=[],logs=[];
 const got=await consultWithFallback(args(async(url,req)=>{
  calls.push({url,headers:req.headers});
  if(url.includes('generativelanguage'))return {ok:false,status:429,json:async()=>({error:{status:'RESOURCE_EXHAUSTED'}})};
  assert.equal(req.headers.Authorization,'Bearer deepseek-test');
  assert.match(JSON.parse(req.body).messages[0].content,/SUPERVISOR/);
  return ok();
 },x=>logs.push(x)));
 assert.equal(calls.length,2);assert.match(calls[0].url,/generativelanguage/);
 assert.match(calls[1].url,/api.deepseek.com/);
 assert.equal(got.focus,'danielnep/michelle-preview');
 assert.equal(got.source,'deepseek-supervisor');
 assert.match(logs[0],/"result":"success"/);
 assert.doesNotMatch(logs[0],/deepseek-test/);
});
test('Gemini 503 ou timeout usa DeepSeek sem esperar nova rodada',async()=>{
 for(const failure of [503,'timeout']){
  let n=0;
  const got=await consultWithFallback(args(async(url)=>{
   n++;
   if(url.includes('generativelanguage')) {
    if(failure==='timeout')throw new Error('timeout');
    return {ok:false,status:503,json:async()=>({error:{status:'UNAVAILABLE'}})};
   }
   return ok();
  }));
  assert.equal(n,2);
  assert.equal(got.priority,'high');
 }
});
test('Gemini saudável não usa DeepSeek',async()=>{
 let calls=0;
 const data=await consultWithFallback(args(async(url)=>{
  calls++;
  assert.match(url,/generativelanguage/);
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(decision)}]}}]})};
 }));
 assert.equal(calls,1);assert.equal(data.priority,'high');assert.equal(data.source,'gemini-supervisor');
});
test('ambos indisponíveis: falha clara e sem segredo em logs',async()=>{
 const logs=[];
 await assert.rejects(()=>consultWithFallback(args(async(url)=>{
  return {ok:false,status:url.includes('generativelanguage')?429:503,
    json:async()=>({error:{message:'secret'}})};
 },x=>logs.push(x))),/Gemini HTTP 429; DeepSeek DeepSeek HTTP 503/);
 assert.doesNotMatch(logs.join(''),/deepseek-test/);
});
test('sem chave DeepSeek registra bloqueio, não ignora a falha',async()=>{
 const logs=[];
 const options=args(async()=>({ok:false,status:429,json:async()=>({error:{}})}),x=>logs.push(x));
 await assert.rejects(()=>consultWithFallback({...options,deepSeekKey:''}),
 /DeepSeek credential_missing/);
 assert.match(logs[0],/"result":"failed"/);
});
test('supervisor completo publica decisão do DeepSeek quando Gemini 429',async()=>{
 const logs=[];
 let providerCalls=0;
 const fetcher=async(url,req)=>{
  if(!url.includes('generativelanguage')&&!url.includes('api.deepseek.com'))
    return {ok:true,text:async()=>JSON.stringify({schema_version:2,updated_at:'2026-10-19T03:00:00Z',
      last_execution:{id:'run-1',status:'verified',summary:'feito',verification:'testes',blocker:''},projects:[]})};
  providerCalls++;
  if(url.includes('generativelanguage'))
    return {ok:false,status:429,json:async()=>({error:{status:'RESOURCE_EXHAUSTED'}})};
  return ok();
 };
 // Dependency injection exposes provider options for no-credential tests.
 const status=await runSupervisorCycle({fetcher,
  priorityQueueLoader:async()=>({status:'verified',tasks:[],highest:null}),
  gemini:options=>consultWithFallback({...options,apiKey:'test',deepSeekKey:'test'}),
  checkpointUrl:'',clock:()=>now,log:x=>logs.push(x)});
 assert.equal(providerCalls,2);assert.equal(status.decision.focus,'danielnep/michelle-preview');
 assert.equal(status.decision.source,'deepseek-supervisor');
 assert.ok(logs.some(x=>x.startsWith('[maestro-handoff]')));
});

test('Gemini e DeepSeek falham: supervisor chama transporte May, aceita apenas decisão validada',async()=>{
 const called=[],logs=[];
 const now=new Date('2026-10-20T08:00:00Z');
 const chosen={protocolVersion:2,source:'may-browser-supervisor',
  nextCallMinutes:60,nextCallAt:'2026-10-20T09:00:00.000Z',
  priority:'critical',focus:'danielnep/app-hondas-maxvel',
  nextMayTask:'Priorizar Ronda Pro P0'};
 const out=await consultWithFallback({...args(async(url)=>{
  called.push(url);
  return {ok:false,status:url.includes('generativelanguage')?429:402,json:async()=>({error:{}})};
 }),now,env:{KERNEL_API_KEY:'synthetic-key'},
 priorityQueue:{status:'verified',highest:{id:'p0-ronda',priority:'P0',repo:'danielnep/app-hondas-maxvel'}},
 mayTransport:async request=>{called.push('may-browser');assert.equal(request.priorityQueue.highest.id,'p0-ronda');return {status:'answered',decision:chosen};},
 log:x=>logs.push(x)});
 assert.equal(out.source,'may-browser-supervisor');
 assert.equal(called.at(-1),'may-browser');
 assert.ok(logs.some(x=>x.includes('[maestro-may-fallback]')&&x.includes('"status":"answered"')));
});
test('Fallback de May indisponível não vira sucesso nem finge envio',async()=>{
 let tries=0;
 await assert.rejects(()=>consultWithFallback({
  ...args(async url=>({ok:false,status:url.includes('generativelanguage')?429:402,json:async()=>({error:{}})})),
  mayTransport:async()=>{tries++;return {status:'draft_preserved'};},
  log:()=>{} }),/Supervisor indisponivel/);
 assert.equal(tries,1);
});
test('Ticket estável e pergunta pública exclui payload privado',()=>{
 const q={highest:{id:'a-ronda-pro-auditoria-total-20261019',priority:'P0',
  repo:'danielnep/app-hondas-maxvel'}};
 const a=consultationTicket({priorityQueue:q,checkpoint:{last_execution:{id:'same'}}});
 const b=consultationTicket({priorityQueue:q,checkpoint:{last_execution:{id:'same'}}});
 assert.equal(a,b);assert.match(a,/^[a-f0-9]{20}$/);
 const p=publicConsultation({ticket:a,priorityQueue:q,checkpointStatus:'stale'});
 assert.match(p,/AGENTE: may-maestro/);assert.match(p,/TIPO: providers_unavailable/);
 assert.match(p,/Ronda Pro|ronda-pro/);
 assert.doesNotMatch(p,/senha|api.key/i);
});
function storeMock(initial={}){
 let state={version:1,handoffs:[],lastObservation:null,...initial};
 return {read:async()=>structuredClone(state),write:async v=>{state=structuredClone(v);},
  snapshot:()=>structuredClone(state)};
}
test('Rascunhos em abas preservados; nenhum comando de mouse ou teclado',async()=>{
 const store=storeMock(),calls=[];
 const out=await requestMayBrowserDecision({
  env:{KERNEL_API_KEY:'synthetic'},store,
  priorityQueue:{highest:{id:'ronda',priority:'P0',repo:'danielnep/app-hondas-maxvel'}},
  checkpointStatus:'stale',
  post:async(url)=>{calls.push(url);return calls.length===1?{status:'not_found'}:{status:'composer_busy'};}
 });
 assert.equal(out.status,'draft_preserved');
 assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x.endsWith('/playwright/execute')));
 assert.equal(store.snapshot().mayBrowserFallback,undefined);
});
test('Antes de tocar a interface, salva ticket; não repete envio duvidoso',async()=>{
 const store=storeMock(),calls=[];
 const phases=[{status:'not_found'},{status:'ready',box:{x:140,y:650}},
  null,null,{status:'draft_ready'},null,{status:'sent'}];
 const post=async(url,body)=>{calls.push({url,body});return phases.shift();};
 const opts={env:{KERNEL_API_KEY:'synthetic'},store,post,
  priorityQueue:{highest:{id:'ronda',priority:'P0',repo:'danielnep/app-hondas-maxvel'}},
  checkpointStatus:'stale'};
 const out=await requestMayBrowserDecision(opts);
 assert.equal(out.status,'sent_waiting_for_reply');
 assert.ok(store.snapshot().mayBrowserFallback.ticket);
 assert.deepEqual(calls.map(x=>x.url.split('/').at(-1)),
   ['execute','execute','click_mouse','type_text','execute','press_key','execute']);
 calls.length=0;
 const second=await requestMayBrowserDecision({...opts,post:async(url)=>{calls.push({url});return {status:'not_found'};}});
 assert.equal(second.status,'delivery_unconfirmed_no_resend');
 assert.equal(calls.length,1);
});
test('Resposta já existente é lida sem reenviar, validada e marcada como May',async()=>{
 const store=storeMock();
 const q={highest:{id:'ronda',priority:'P0',repo:'danielnep/app-hondas-maxvel'}};
 const payload={...decision,priority:'critical',focus:'danielnep/app-hondas-maxvel',
   next_may_task:'Retomar tarefa P0 ronda'};
 const result=await requestMayBrowserDecision({
  env:{KERNEL_API_KEY:'synthetic'},store,priorityQueue:q,checkpointStatus:'stale',
  now:new Date('2026-10-20T08:00:00Z'),
  post:async(url)=>{assert.ok(url.endsWith('/playwright/execute'));return {status:'answered',answer:JSON.stringify(payload)};}
 });
 assert.equal(result.status,'answered');
 assert.equal(result.decision.source,'may-browser-supervisor');
 assert.equal(store.snapshot().mayBrowserFallback.status,'answered');
});
