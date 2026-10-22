import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server.mjs';
import {SPECIALISTS,operationalDigest,teamLog,deriveCodePaths,quickAnswer,conciseProjectFacts,safePublishedUrl} from '../central/controller.mjs';
import {operationalTelemetry} from '../central/telemetry.mjs';
import {submitDirectTask,directTasks,directTaskAction,directAgentAction,agentHolds} from '../maestro/direct-queue.mjs';

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

test('central envia direto ao Maestro na VPS, sem gravar solicitações no GitHub',async()=>{
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
  assert.equal(out.transport,'vps_local');
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
  teamLog('[horizon-team] cycle_summary {"processed":0,"rejected":0,"deferred":1}');
  teamLog('[horizon-team] cycle {"rc":0,"seconds":90}');
  let found='',tries=0;
  while(!found.includes('"kind":"worker"')&&tries++<3){
   const item=await reader.read();if(item.done)break;found+=new TextDecoder().decode(item.value);
  }
  assert.match(found,/"event":"cycle"/);
  assert.match(found,/"rc":"0"/);
  const overview=await (await fetch(url+'/central/api/overview')).json();
  // SSE may report local process events; without an authenticated VPS source, overview stays offline.
  assert.equal(overview.available.vps,false);
  assert.equal(overview.worker.status,'Sem ligação com a VPS');
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

test('supervisor wait and dependency proof appear in real task API',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-supervision-'));
 const prior=process.env.HORIZON_DIRECT_INBOX_DIR;
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  await mkdir(join(root,'requests'),{recursive:true});
  await mkdir(join(root,'results'),{recursive:true});
  const id='ctl-supervised-20261021';
  await writeFile(join(root,'requests',id+'.json'),JSON.stringify({
   owner:'danielnep',task_id:id,agent:'may-maestro',project:'ronda-pro',
   repository:'danielnep/app-hondas-maxvel',objective:'Validar interface mobile do Ronda Pro'
  }));
  await writeFile(join(root,'results',id+'.json'),JSON.stringify({
   request_id:id,status:'pending',quality:{approved:false},
   supervision:{reason:'scheduled_retry',first_pending_task:'chat-'+id+':ui',
    first_pending_agent:'ui-ux-designer',retry_reason:'groq_capacity_wait',
    next_retry_at:'2026-10-21T09:00:00Z',checked_at:'2026-10-21T06:00:00Z',blocked_by:[]},
   tasks:[
    {task_id:'chat-'+id,agent:'may-maestro',status:'succeeded',attempts:1},
    {task_id:'chat-'+id+':ui',agent:'ui-ux-designer',status:'queued',
     wait_reason:'scheduled_retry',retry_reason:'groq_capacity_wait',
     next_retry_at:'2026-10-21T09:00:00Z',blocked_by:[],attempts:2,max_attempts:3},
    {task_id:'chat-'+id+':qa',agent:'qa-engineer',status:'queued',
     wait_reason:'waiting_for_dependencies',blocked_by:['chat-'+id+':ui'],attempts:0,max_attempts:3}
   ]}));
  const local=(await directTasks())[0];
  assert.equal(local.status,'aguardando');
  assert.equal(local.supervision.reason,'scheduled_retry');
  assert.equal(local.supervision.firstPendingAgent,'ui-ux-designer');
  assert.equal(local.stages[1].attempts,2);
  assert.deepEqual(local.stages[2].blockedBy,['chat-'+id+':ui']);
  // The worker's durable report event invalidates any previously cached view.
  teamLog('[horizon-team] supervisor_wait {"taskId":"'+id+'","reason":"scheduled_retry"}');
  await withServer(async({url})=>{
   const res=await fetch(url+'/central/api/tasks');
   assert.equal(res.status,200);
   const task=(await res.json()).tasks.find(x=>x.id===id);
   assert.equal(task.supervision.retryReason,'groq_capacity_wait');
   assert.equal(task.stages[2].waitReason,'waiting_for_dependencies');
   const ui=await (await fetch(url+'/central/app.js')).text();
   assert.match(ui,/function waitDescription/);
   assert.match(ui,/Primeira etapa:/);
   assert.match(ui,/Etapas, motivos e retomada/);
  });
 }finally{
  if(prior===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;
  else process.env.HORIZON_DIRECT_INBOX_DIR=prior;
  await rm(root,{recursive:true,force:true});
 }
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

test('holding one agent pauses its pending work and rejects new work until resumed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-approval-agent-'));
 const old=process.env.HORIZON_DIRECT_INBOX_DIR;
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  const input={project:'romaneio-digital',repository:'danielnep/romaneio-digital',
   objective:'Revisar o código sem alterar o fluxo atual',agent:'qa-engineer',
   priority:'P2',delivery_type:'existing_product',allowed_paths:['js/**'],public_data_confirmed:true};
  const task=await submitDirectTask(input);
  const paused=await directAgentAction('qa-engineer','pause');
  assert.equal(paused.affected,1);
  assert.ok((await agentHolds()).includes('qa-engineer'));
  assert.equal((await directTasks()).find(t=>t.id===task.id).status,'pausada');
  await assert.rejects(()=>submitDirectTask(input),/agente_tem_novas_tarefas_pausadas/);
  await directAgentAction('qa-engineer','resume');
  assert.equal((await directTasks()).find(t=>t.id===task.id).inQueue,true);
 }finally{
  if(old===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;else process.env.HORIZON_DIRECT_INBOX_DIR=old;
  await rm(root,{recursive:true,force:true});
 }
});

test('tokens from two real provider receipt shapes are counted by agent and model',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-tokens-'));
 const old=process.env.HORIZON_DIRECT_INBOX_DIR;
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  await mkdir(join(root,'telemetry'));
  const today=new Date().toISOString().slice(0,10);
  await writeFile(join(root,'telemetry','usage-'+today+'.jsonl'),[
   JSON.stringify({at:new Date().toISOString(),agent:'qa-engineer',provider:'gemini',model:'gemini-3.5-flash-lite',input:100,output:20,total:128}),
   JSON.stringify({at:new Date().toISOString(),agent:'backend-engineer',provider:'groq',model:'openai/gpt-oss-120b',input:250,output:60,total:310})
  ].join('\n')+'\n');
  await writeFile(join(root,'telemetry','activity-'+today+'.jsonl'),[
   JSON.stringify({at:new Date().toISOString(),taskId:'ctl-testing',agent:'qa-engineer',action:'write_file',step:2,path:'src/app.js'})
  ].join('\n')+'\n');
  const data=await operationalTelemetry(7);
  assert.equal(data.usage.total,438);
  assert.equal(data.usage.input,350);
  assert.equal(data.usage.output,80);
  assert.equal(data.usage.byAgent['qa-engineer'].total,128);
  assert.equal(data.usage.byProvider.groq.total,310);
  assert.equal(data.activity.lastByTask['ctl-testing'].path,'src/app.js');
 }finally{
  if(old===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;else process.env.HORIZON_DIRECT_INBOX_DIR=old;
  await rm(root,{recursive:true,force:true});
 }
});
test('chat answers common questions with algorithms without model calls',async()=>{
 const view={agents:[],tasks:[{id:'ctl-1',inQueue:true}],usage:{available:true,days:7,total:480,calls:4}};
 assert.match(quickAnswer('quantos agentes existem?',view),/17 especialistas/);
 assert.match(quickAnswer('quantos tokens consumimos?',view),/480/);
 assert.match(quickAnswer('quantas tarefas na fila?',view),/1 tarefas/);
 assert.equal(quickAnswer('O que é esta função pouco comum?',view),null);
 const context=conciseProjectFacts({...view,at:'2026-10-21T00:00:00Z'},'quantos agentes');
 assert.equal(context.numeroTarefas,1);
 assert.equal(context.fonte,'Central Horizon, fila local do servidor');
});
test('help chat uses simple Portuguese and is available without secret access',async()=>{
 await withServer(async({url,origin})=>{
  const response=await fetch(url+'/central/api/ai/chat',{method:'POST',
   headers:{origin,'content-type':'application/json'},
   body:JSON.stringify({message:'quantos agentes temos?'})});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.match(body.response,/17 especialistas/);
  assert.equal(body.usage.total,0);
  const html=await fetch(url+'/central/').then(x=>x.text());
  assert.match(html,/id="help-panel"/);
  assert.match(html,/id="action-gate"/);
  const script=await fetch(url+'/central/app.js').then(x=>x.text());
  assert.doesNotMatch(script,/&&confirm\(/);
  assert.match(script,/function janelaDeAcao/);
  assert.match(script,/function acaoEmPortugues/);
 });
});


test('studio assets, responsive controls and safe embedded-preview policy are shipped',async()=>{
 await withServer(async({url})=>{
  const [html,js,css,main]=await Promise.all([
   fetch(url+'/central/').then(r=>r.text()),
   fetch(url+'/central/studio.mjs').then(r=>r.text()),
   fetch(url+'/central/studio.css').then(r=>r.text()),
   fetch(url+'/central/app.js').then(r=>r.text())
  ]);
  assert.match(html,/data-page="estudio"/);
  assert.match(html,/studio\.css/);
  assert.match(js,/mobile.*tablet.*desktop/);
  assert.match(js,/setInterval\(\(\)=>void probe\(\),20000\)/);
  assert.match(js,/iframe id="studio-frame"/);
  assert.match(css,/\.studio-layout/);
  assert.match(css,/\.studio-expanded/);
  assert.match(main,/mountStudio/);
  const headers=await fetch(url+'/central/');
  assert.match(headers.headers.get('content-security-policy'),/frame-src https:/);
 });
});
test('preview endpoint protects repository scope and blocks network access to private hosts',async()=>{
 await withServer(async({url})=>{
  for(const repository of ['evil.example/repo','danielnep/../../private','']){
   const res=await fetch(url+'/central/api/preview?repository='+encodeURIComponent(repository));
   assert.equal(res.status,400);
  }
  assert.equal(safePublishedUrl('http://danielnep.github.io/demo'),null);
  assert.equal(safePublishedUrl('https://127.0.0.1/private'),null);
  assert.equal(safePublishedUrl('https://example.com/private'),null);
  assert.equal(safePublishedUrl('https://danielnep.github.io/app-hondas-maxvel/'),'https://danielnep.github.io/app-hondas-maxvel/');
  assert.equal(safePublishedUrl('https://web-demo.up.railway.app/'),'https://web-demo.up.railway.app/');
 });
});
