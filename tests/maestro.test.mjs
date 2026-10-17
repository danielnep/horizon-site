import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consultGemini,normalizeDecision,PLUGINS,IDENTITY,startScheduledReviewer} from '../maestro-worker.mjs';
import {startServer} from '../server.mjs';
const decision={next_call_minutes:90,next_may_task:'May deve verificar CI',why_this_time:'CI deve ter finalizado',acceptance_criteria:'Testes registrados',confidence:'limited-context'};
test('chave ausente',async()=>{await assert.rejects(()=>consultGemini({apiKey:''}),/ausente/)});
test('Gemini sabe seu papel e escolhe o horario',async()=>{
 const mock=async(_url,opts)=>{assert.equal(opts.headers['x-goog-api-key'],'teste');
 const p=JSON.parse(opts.body).contents[0].parts[0].text;assert.match(p,/SUPERVISOR DE CHAMADAS/);assert.match(p,/SOMENTE May/);
 return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(decision)}]}}]})}};
 const r=await consultGemini({apiKey:'teste',fetcher:mock,now:new Date('2026-10-17T14:00:00Z')});
 assert.equal(r.nextCallAt,'2026-10-17T15:30:00.000Z');assert.equal(r.nextCallMinutes,90);
 assert.equal(PLUGINS.length,7);assert.equal(IDENTITY.automationId,'6ad32bbba5488191aee18ef5fafd37b7');
});
test('respeita intervalo >=60 e valida plano',()=>{
 assert.throws(()=>normalizeDecision({...decision,next_call_minutes:15}),/60/);
 assert.throws(()=>normalizeDecision({...decision,next_call_minutes:10081}),/10080/);
 assert.throws(()=>normalizeDecision({...decision,next_may_task:''}),/incompleto/);
});
test('proximo timer segue exatamente Gemini, nao 12 horas',async()=>{
 const ms=[],calls=[];
 const stop=startScheduledReviewer({env:{MAESTRO_ENABLE_AUTO:'1'},run:async()=>normalizeDecision(decision,new Date('2026-10-17T14:00:00Z')),log:()=>{},schedule:(f,d)=>{ms.push(d);calls.push(f);return {unref(){}};},cancel:()=>{}});
 assert.equal(ms[0],12000);await calls[0]();assert.equal(ms[1],5400000);stop();
});
test('erro reconsulta em uma hora',async()=>{
 const ms=[],calls=[];
 startScheduledReviewer({env:{MAESTRO_ENABLE_AUTO:'1'},run:async()=>{throw Error('offline')},log:()=>{},schedule:(f,d)=>{ms.push(d);calls.push(f);return {unref(){}};},cancel:()=>{}});
 await calls[0]();assert.equal(ms[1],3600000);
});
test('site e rotas internas',async()=>{
 const srv=startServer({listenPort:0,background:false,reader:async()=>Buffer.from('<html>Horizon</html>')});
 await new Promise(r=>srv.once('listening',r));const url='http://127.0.0.1:'+srv.address().port;
 try{assert.equal((await fetch(url+'/health')).status,200);assert.match(await(await fetch(url+'/')).text(),/Horizon/);
 assert.equal((await fetch(url+'/maestro-worker.mjs')).status,404);}finally{await new Promise(r=>srv.close(r))}
});
test('modo desligado',()=>{const logs=[];startScheduledReviewer({env:{},log:x=>logs.push(x)})();assert.match(logs[0],/desabilitada/)});
