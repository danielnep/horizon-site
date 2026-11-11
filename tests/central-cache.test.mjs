import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startServer} from '../server.mjs';

test('versioned UI assets cannot mix a new app with stale mobile CSS',async()=>{
 const server=startServer({listenPort:0,background:false});
 await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port+'/central/';
 try{
  const page=await fetch(base,{cache:'no-store'});
  assert.equal(page.status,200);
  assert.match(page.headers.get('cache-control')||'',/no-store/);
  const html=await page.text();
  const fingerprint=html.match(/\.\/studio-r3\.css\?v=([a-f0-9]{16})/);
  assert.ok(fingerprint,'CSS must have a content-derived revision in the HTML');
  const version=fingerprint[1];
  for(const asset of ['studio-r3.css','studio-r3.mjs']){
   assert.ok(html.includes('./'+asset+'?v='+version),asset+' must share revision');
   const response=await fetch(base+asset+'?v='+version);
   assert.equal(response.status,200,asset);
   assert.match(response.headers.get('cache-control')||'',/no-store/,asset+' must bypass HTTP cache');
  }
  assert.doesNotMatch(html,/\.\/app\.js|Carregando a central|class="side"/);
  const worker=await fetch(base+'sw.js');
  assert.equal(worker.status,200);
  assert.match(worker.headers.get('cache-control')||'',/no-store/);
 }finally{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
 }
});
