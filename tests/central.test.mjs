import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startServer} from '../server.mjs';
import {SPECIALISTS} from '../central/controller.mjs';

async function withServer(fn){
 const old=process.env.HORIZON_MCP_TOKEN;
 process.env.HORIZON_MCP_TOKEN='local-test-only-strong-secret-value';
 const server=startServer({listenPort:0,background:false});
 await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port;
 const origin='https://127.0.0.1:'+server.address().port;
 try{await fn({url,origin});}
 finally{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  if(old===undefined)delete process.env.HORIZON_MCP_TOKEN;else process.env.HORIZON_MCP_TOKEN=old;
 }
}
test('central includes all 17 real specialist identifiers',()=>assert.equal(SPECIALISTS.length,17));
test('PWA loads on existing Horizon server without changing the institutional homepage',async()=>{
 await withServer(async({url})=>{
  const [site,central,manifest,script,health]=await Promise.all(['/','/central/','/central/manifest.webmanifest','/central/app.js','/health'].map(p=>fetch(url+p)));
  assert.equal(site.status,200);assert.match(await site.text(),/Horizon/i);
  assert.equal(central.status,200);assert.match(await central.text(),/Central de Agentes/);
  assert.equal(manifest.status,200);assert.equal(JSON.parse(await manifest.text()).scope,'/central/');
  assert.equal(script.status,200);assert.match(await script.text(),/EventSource/);
  assert.equal(health.status,200);
 });
});
test('panel refuses traversal, modification of static files, and unauthenticated data',async()=>{
 await withServer(async({url})=>{
  assert.equal((await fetch(url+'/central/unknown')).status,404);
  assert.equal((await fetch(url+'/central/..%2Fserver.mjs')).status,404);
  assert.equal((await fetch(url+'/central/app.js',{method:'POST'})).status,405);
  assert.equal((await fetch(url+'/central/api/overview')).status,401);
  assert.equal((await fetch(url+'/central/api/tasks',{method:'POST',headers:{origin:'https://malicious.example','content-type':'application/json'},body:'{}'})).status,401);
  const sw=await fetch(url+'/central/sw.js');assert.equal(sw.status,200);
  assert.doesNotMatch(await sw.text(),/cache\.put\([^)]*\/api/);
 });
});
test('login requires same-origin, issues HttpOnly session and protects write commands',async()=>{
 await withServer(async({url,origin})=>{
  const data=JSON.stringify({password:'local-test-only-strong-secret-value'});
  const headers={'content-type':'application/json',origin};
  assert.equal((await fetch(url+'/central/api/login',{method:'POST',headers:{...headers,origin:'https://other.example'},body:data})).status,403);
  assert.equal((await fetch(url+'/central/api/login',{method:'POST',headers,body:JSON.stringify({password:'wrong'})})).status,401);
  const login=await fetch(url+'/central/api/login',{method:'POST',headers,body:data});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
  const session=cookie.split(';')[0];
  const check=await fetch(url+'/central/api/session',{headers:{cookie:session}});
  assert.equal((await check.json()).authenticated,true);
  const blocked=await fetch(url+'/central/api/tasks',{method:'POST',headers:{'content-type':'application/json',origin:'https://other.example',cookie:session},body:'{}'});
  assert.equal(blocked.status,403);
  const empty=await fetch(url+'/central/api/tasks',{method:'POST',headers:{...headers,cookie:session},body:JSON.stringify({objective:'hello world',public_data_confirmed:false})});
  assert.equal(empty.status,400);
  const stream=await fetch(url+'/central/api/events',{headers:{cookie:session}});
  assert.equal(stream.status,200);assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  await stream.body.cancel();
 });
});
