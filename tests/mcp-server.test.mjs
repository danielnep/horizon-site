import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleHorizonMcp} from '../maestro/mcp-server.mjs';
const KEY='local-test-auth-token';
async function serverWith({fetcher}={}){
 const server=http.createServer((q,r)=>handleHorizonMcp(q,r,{token:KEY,fetcher}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {url:'http://127.0.0.1:'+server.address().port+'/mcp',
  close:()=>new Promise(done=>server.close(done))};
}
async function call(url,method,params={},auth=KEY,origin){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',
  'accept':'application/json, text/event-stream',
  ...(auth?{'authorization':'Bearer '+auth}:{}),...(origin?{origin}:{})},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 return {status:r.status,body:await r.json()};
}
async function withInbox(fn){
 const previous=process.env.HORIZON_DIRECT_INBOX_DIR;
 const dir=await mkdtemp(join(tmpdir(),'horizon-direct-'));
 process.env.HORIZON_DIRECT_INBOX_DIR=dir;
 try{await fn(dir);}finally{
  if(previous===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;
  else process.env.HORIZON_DIRECT_INBOX_DIR=previous;
  await rm(dir,{recursive:true,force:true});
 }
}
test('MCP autenticacao e lista de 17 agentes',async()=>{
 const s=await serverWith();try{
  assert.equal((await call(s.url,'tools/list',{},null)).status,401);
  assert.equal((await call(s.url,'tools/list',{},KEY,'https://evil.example')).status,403);
  const i=await call(s.url,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(i.body.result.protocolVersion,'2025-11-25');
  const l=await call(s.url,'tools/list');assert.equal(l.body.result.tools.length,4);
  assert.match(l.body.result.tools.find(x=>x.name==='horizon_submit_task').description,/VPS/);
 }finally{await s.close();}
});
test('MCP recusa submissao invalida antes de gravar',async()=>await withInbox(async()=>{
 const s=await serverWith();try{
  const a=await call(s.url,'tools/call',{name:'horizon_list_agents',arguments:{}});
  assert.equal(JSON.parse(a.body.result.content[0].text).count,17);
  const r=await call(s.url,'tools/call',{name:'horizon_submit_task',arguments:{
    task_id:'task-aaa',project:'sample',repository:'danielnep/romaneio-digital',
    agent:'may-maestro',objective:'Melhorar interface de atendimento sem mudar fluxo',
    delivery_type:'existing_product',public_data_confirmed:false,allowed_paths:['css/style.css']}});
  assert.equal(r.body.result.isError,true);
 }finally{await s.close();}
}));
test('MCP grava tarefa na fila da VPS, sem chamar GitHub, idempotente',async()=>await withInbox(async(dir)=>{
 let ghCalls=0;
 const s=await serverWith({fetcher:async()=>{ghCalls++;throw Error('GitHub should not be contacted');}});
 const args={task_id:'romaneio-ui-test',project:'romaneio-digital',repository:'danielnep/romaneio-digital',
  agent:'may-maestro',objective:'Analisar e melhorar interface e animacoes sem alterar fluxos',
  delivery_type:'existing_product',priority:'P2',public_data_confirmed:true,
  allowed_paths:['index.html','css/style.css']};
 try{
  const r=await call(s.url,'tools/call',{name:'horizon_submit_task',arguments:args});
  const receipt=JSON.parse(r.body.result.content[0].text);
  assert.equal(receipt.status,'aceita');assert.equal(receipt.transport,'vps_local');
  const stored=JSON.parse(await readFile(join(dir,'requests',args.task_id+'.json'),'utf8'));
  assert.equal(stored.repository,args.repository);
  assert.deepEqual(stored.payload.allowed_paths,args.allowed_paths);
  const second=await call(s.url,'tools/call',{name:'horizon_submit_task',arguments:args});
  assert.equal(JSON.parse(second.body.result.content[0].text).status,'aceita_previamente');
  const check=await call(s.url,'tools/call',{name:'horizon_task_status',arguments:{task_id:args.task_id}});
  assert.equal(JSON.parse(check.body.result.content[0].text).status,'accepted');
  assert.equal(ghCalls,0);
 }finally{await s.close();}
}));
