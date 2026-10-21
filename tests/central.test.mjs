import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server.mjs';
import {SPECIALISTS,operationalDigest,teamLog,deriveCodePaths} from '../central/controller.mjs';
import {submitDirectTask,directTasks,directTaskAction} from '../maestro/direct-queue.mjs';

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
  assert.equal(manifest.status,200);assert.equal(new URL(JSON.parse(await manifest.text()).scope,url+'/central/').pathname,'/central/');
  assert.equal(script.status,200);assert.match(await script.text(),/EventSource/);
  assert.equal(health.status,200);
 });
});
test('panel refuses traversal, modification of static files, and unauthenticated data',async()=>{
 await withServer(async({url})=>{
  assert.equal((await fetch(url+'/central/unknown')).status,404);
  assert.equal((await fetch(url+'/central/..%2Fserver.mjs')).status,404);
  assert.equal((await fetch(url+'/central/app.js',{method:'POST'})).status,405);
  assert.equal((await fetch(url+'/central/api/overview')).status,200);
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

test('central envia direto ao Maestro no Railway, sem gravar solicitações no GitHub',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-central-'));
 const previous=process.env.HORIZON_DIRECT_INBOX_DIR;
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
 await withServer(async({url,origin})=>{
  const login=await fetch(url+'/central/api/login',{method:'POST',
   headers:{origin,'content-type':'application/json'},
   body:JSON.stringify({password:'local-test-only-strong-secret-value'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={origin,cookie,'content-type':'application/json'};
  const task={project:'romaneio-digital',repository:'danielnep/romaneio-digital',
   objective:'Melhorar a UI e as animações sem alterar navegação e regras',
   agent:'may-maestro',priority:'P2',public_data_confirmed:true,
   delivery_type:'existing_product',allowed_paths:['css/style.css','index.html']};
  const response=await fetch(url+'/central/api/tasks',
   {method:'POST',headers,body:JSON.stringify(task)});
  assert.equal(response.status,201);
  const out=await response.json();
  assert.equal(out.transport,'railway_local');
  const body=JSON.parse(await readFile(join(root,'requests',out.id+'.json'),'utf8'));
  assert.equal(body.repository,task.repository);
  assert.deepEqual(body.payload.allowed_paths,task.allowed_paths);
  const tasks=await fetch(url+'/central/api/tasks',{headers:{cookie}});
  assert.equal(tasks.status,200);
  const state=await tasks.json();
  assert.ok(state.tasks.some(x=>x.id===out.id));
 });
 }finally{
  if(previous===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;
  else process.env.HORIZON_DIRECT_INBOX_DIR=previous;
  await rm(root,{recursive:true,force:true});
 }
});
test('PWA install icons are served with PNG MIME',async()=>{
 await withServer(async({url})=>{
  for(const icon of ['/central/icon-192.png','/central/icon-512.png']){
   const r=await fetch(url+icon);
   assert.equal(r.status,200);
   assert.equal(r.headers.get('content-type'),'image/png');
   const bytes=new Uint8Array(await r.arrayBuffer());
   assert.deepEqual(Array.from(bytes.slice(0,8)),[137,80,78,71,13,10,26,10]);
  }
 });
});
test('change detector ignores request timestamps but detects agent and task updates',()=>{
 const state={at:'2026-10-21T00:00:00Z',tasks:[],agents:[{id:'may-maestro',status:'ocioso'}],available:{queue:true},issues:[]};
 const before=operationalDigest(state);
 assert.equal(before,operationalDigest({...state,at:'2026-10-21T02:00:00Z'}));
 assert.notEqual(before,operationalDigest({...state,agents:[{id:'may-maestro',status:'em execução'}]}));
 assert.notEqual(before,operationalDigest({...state,tasks:[{id:'request-1',status:'na fila'}]}));
});
test('SSE immediately streams actual worker state, never needs an AI call',async()=>{
 await withServer(async({url,origin})=>{
  const login=await fetch(url+'/central/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:'local-test-only-strong-secret-value'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const abort=new AbortController();
  const response=await fetch(url+'/central/api/events',{headers:{cookie},signal:abort.signal});
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/retry: 5000/);
  teamLog('[horizon-team] cycle {"rc":0,"seconds":90}');
  let found='',tries=0;
  while(!found.includes('"kind":"worker"')&&tries++<3){
   const item=await reader.read();if(item.done)break;found+=new TextDecoder().decode(item.value);
  }
  assert.match(found,/"event":"cycle"/);
  assert.match(found,/"rc":"0"/);
  abort.abort();
  await reader.cancel().catch(()=>{});
 });
});

test('monitoring and live events do not require a password; modifying tasks still does',async()=>{
 await withServer(async({url})=>{
  assert.equal((await fetch(url+'/central/api/agents')).status,200);
  assert.equal((await fetch(url+'/central/api/history')).status,200);
  const ctrl=new AbortController();
  const stream=await fetch(url+'/central/api/events',{signal:ctrl.signal});
  assert.equal(stream.status,200);
  assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  await stream.body.cancel();
  ctrl.abort();
  assert.equal((await fetch(url+'/central/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 });
});
test('PWA dashboard does not block visitors behind the login overlay',async()=>{
 await withServer(async({url})=>{
  const [html,script]=await Promise.all([fetch(url+'/central/').then(x=>x.text()),fetch(url+'/central/app.js').then(x=>x.text())]);
  assert.match(html,/id="gate"[^>]*hidden/);
  assert.match(html,/Voltar ao acompanhamento/);
  assert.match(script,/async function boot\(\)\{\s*showLogin\(false\)/);
  assert.match(script,/Resultados armazenados/);
  assert.match(script,/t\.stages/);
 });
});

test('all repository selections come from API, never three fixed projects or manual repository input',async()=>{
 await withServer(async({url})=>{
  const script=await fetch(url+'/central/app.js').then(r=>r.text());
  assert.doesNotMatch(script,/const PROJECTS\s*=/);
  assert.doesNotMatch(script,/id="repo"/);
  assert.match(script,/await api\('repositories'\)/);
  assert.match(script,/const repository=project\.value/);
 });
});
test('automatic scope identifies existing project source files and does not select secrets',()=>{
 const items=[
  {name:'src',type:'dir'},{name:'css',type:'dir'},
  {name:'index.html',type:'file'},{name:'server.mjs',type:'file'},
  {name:'.env',type:'file'},{name:'package-lock.json',type:'file'},
  {name:'token.js',type:'file'},{name:'README.md',type:'file'}];
 const paths=deriveCodePaths(items,'danielnep/romaneio-digital');
 assert.deepEqual(paths,['src/**','css/**','index.html','server.mjs']);
});

test('direct queue actions pause, cancel and restore tasks without losing records',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-queue-actions-'));
 const old=process.env.HORIZON_DIRECT_INBOX_DIR;
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  const task=await submitDirectTask({project:'romaneio-digital',repository:'danielnep/romaneio-digital',
   objective:'Testar fluxo do painel e preservar a interface aprovada',agent:'qa-engineer',priority:'P2',
   delivery_type:'existing_product',allowed_paths:['js/**','index.html'],public_data_confirmed:true});
  let rows=await directTasks();assert.equal(rows.find(x=>x.id===task.id).inQueue,true);
  const paused=await directTaskAction(task.id,'pause');
  assert.equal(paused.status,'pausada');
  rows=await directTasks();assert.equal(rows.find(x=>x.id===task.id).status,'pausada');
  const restored=await directTaskAction(task.id,'resume');
  assert.equal(restored.status,'na fila');
  rows=await directTasks();assert.equal(rows.find(x=>x.id===task.id).inQueue,true);
  const cancelled=await directTaskAction(task.id,'cancel');
  assert.equal(cancelled.status,'cancelada');
  rows=await directTasks();assert.equal(rows.find(x=>x.id===task.id).status,'cancelada');
  assert.equal(rows.find(x=>x.id===task.id).inQueue,false);
  await assert.rejects(()=>directTaskAction('../secrets','resume'),/comando_invalido/);
 }finally{
  if(old===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;
  else process.env.HORIZON_DIRECT_INBOX_DIR=old;
  await rm(root,{recursive:true,force:true});
 }
});
test('task control endpoint requires a session and cannot be triggered by strangers',async()=>{
 await withServer(async({url})=>{
  const unauthorized=await fetch(url+'/central/api/tasks/ctl-test-123/action',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel'})});
  assert.equal(unauthorized.status,401);
 });
});
