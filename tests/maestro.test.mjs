import {test} from 'node:test';
import assert from 'node:assert/strict';
import {review,PLUGINS,startScheduledReviewer} from '../maestro-worker.mjs';
import {startServer} from '../server.mjs';
test('sem chave, erro explicito',async()=>{await assert.rejects(()=>review({apiKey:''}),/ausente/)});
test('Gemini autentica pelo header e avalia sete plugins',async()=>{
  const mock=async(_url,opts)=>{assert.equal(opts.headers['x-goog-api-key'],'teste');return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({findings:[],limitations:['sem codigo']})}]}}]})}};
  const v=await review({apiKey:'teste',fetcher:mock});assert.equal(v.plugins,PLUGINS.length);assert.equal(v.mode,'metadata-only');
});
test('HTML, health e negacao de acesso a arquivos internos',async()=>{
 const srv=startServer({listenPort:0,background:false,reader:async()=>Buffer.from('<html>Horizon</html>')});
 await new Promise(r=>srv.once('listening',r));const base='http://127.0.0.1:'+srv.address().port;
 try{
   const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Horizon/);
   const health=await fetch(base+'/health');assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
   assert.equal((await fetch(base+'/maestro-worker.mjs')).status,404);
   assert.equal((await fetch(base+'/package.json')).status,404);
 }finally{await new Promise(r=>srv.close(r))}
});
test('sem MAESTRO_ENABLE_AUTO nao executa ciclos',()=>{const logs=[];startScheduledReviewer({env:{},log:x=>logs.push(x)})();assert.match(logs[0],/desabilitada/)});