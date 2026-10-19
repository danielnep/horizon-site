import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consultWithFallback,consultDeepSeek,runSupervisorCycle} from '../maestro-worker.mjs';

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
 assert.equal(calls,1);assert.equal(data.priority,'high');
});
test('ambos indisponíveis: falha clara e sem segredo em logs',async()=>{
 const logs=[];
 await assert.rejects(()=>consultWithFallback(args(async(url)=>{
  return {ok:false,status:url.includes('generativelanguage')?429:503,
    json:async()=>({error:{message:'secret'}})};
 },x=>logs.push(x))),/Gemini HTTP 429; DeepSeek DeepSeek HTTP 503/);
 assert.doesNotMatch(logs.join(''),'deepseek-test');
});
test('sem chave DeepSeek registra bloqueio, não ignora a falha',async()=>{
 const logs=[];
 await assert.rejects(()=>consultWithFallback({...args(async()=>({ok:false,status:429,json:async()=>({error:{}})}),x=>logs.push(x))),deepSeekKey:''}),
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
  gemini:options=>consultWithFallback({...options,apiKey:'test',deepSeekKey:'test'}),
  checkpointUrl:'',clock:()=>now,log:x=>logs.push(x)});
 assert.equal(providerCalls,2);assert.equal(status.decision.focus,'danielnep/michelle-preview');
 assert.ok(logs.some(x=>x.startsWith('[maestro-handoff]')));
});
