import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleHorizonMcp} from '../maestro/mcp-server.mjs';
const KEY='local-test-auth-token';
const snapshot={source:'vps',worker:{status:'Serviço do Maestro ativo'},agents:[{id:'may-maestro'},{id:'frontend-engineer'}],tasks:[{id:'ctl-test-task',status:'queued',agent:'frontend-engineer',inQueue:true}]};
async function serverWith({vpsRequester=async(path,options)=>{
 if(path==='/v1/snapshot')return snapshot;
 if(path==='/v1/tasks')return {id:'ctl-new-task',status:'na fila',transport:'vps_sqlite',received:options?.data};
 throw Error('unrecognized test route');
},fetcher}={}){
 const server=http.createServer((q,r)=>handleHorizonMcp(q,r,{token:KEY,vpsRequester,fetcher}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {url:'http://127.0.0.1:'+server.address().port+'/mcp',close:()=>new Promise(done=>server.close(done))};
}
async function call(url,method,params={},auth=KEY,origin){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream',...(auth?{'authorization':'Bearer '+auth}:{}),...(origin?{origin}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 return {status:r.status,body:await r.json()};
}
const invoke=async(s,name,args={})=>{
 const r=await call(s.url,'tools/call',{name,arguments:args});return JSON.parse(r.body.result.content[0].text);
};
test('MCP autentica, restringe origins e anuncia ferramentas reais',async()=>{
 const s=await serverWith();try{
  assert.equal((await call(s.url,'tools/list',{},null)).status,401);
  assert.equal((await call(s.url,'tools/list',{},KEY,'https://evil.example')).status,403);
  assert.equal((await call(s.url,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).body.result.protocolVersion,'2025-11-25');
  const l=await call(s.url,'tools/list');assert.equal(l.body.result.tools.length,5);
  assert.ok(l.body.result.tools.some(t=>t.name==='horizon_vps_health'));
 }finally{await s.close();}
});
test('MCP consulta agentes e heartbeat do SQLite via API VPS',async()=>{
 const s=await serverWith();try{
  assert.equal((await invoke(s,'horizon_list_agents')).count,2);
  const h=await invoke(s,'horizon_vps_health');assert.equal(h.worker,'Serviço do Maestro ativo');assert.equal(h.queueSize,1);
  assert.equal((await invoke(s,'horizon_task_status',{task_id:'ctl-test-task'})).status,'queued');
 }finally{await s.close();}
});
test('MCP recusa dados nao confirmados ou invalidos sem escrever na VPS',async()=>{
 let writes=0;const s=await serverWith({vpsRequester:async(path,opt)=>{if(opt?.method==='POST')writes++;return snapshot;}});
 try{
  const r=await invoke(s,'horizon_submit_task',{agent:'frontend-engineer',objective:'Corrigir fluxo de telas Horizon',repository:'danielnep/horizon-site',allowed_paths:['central/'],public_data_confirmed:false});
  assert.equal(r.error,'solicitacao_invalida_ou_nao_confirmada');assert.equal(writes,0);
 }finally{await s.close();}
});
test('MCP entrega tarefas ao MESMO SQLite que o worker, sem fila paralela',async()=>{
 const calls=[];
 const s=await serverWith({vpsRequester:async(path,options)=>{
  calls.push({path,options});if(path==='/v1/tasks')return {id:'ctl-new-task',status:'na fila',transport:'vps_sqlite'};
  return snapshot;
 }});
 const args={task_id:'legacy-request-id',project:'horizon',repository:'danielnep/horizon-site',agent:'frontend-engineer',objective:'Corrigir tela operacional e validar acessibilidade',priority:'P1',delivery_type:'existing_product',public_data_confirmed:true,allowed_paths:['central/index.html']};
 try{
  const r=await invoke(s,'horizon_submit_task',args);
  assert.equal(r.id,'ctl-new-task');assert.equal(r.source,'vps_sqlite');assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/v1/tasks');assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.data.agent,'frontend-engineer');
  assert.ok(!Object.hasOwn(calls[0].options.data,'task_id'));
 }finally{await s.close();}
});
test('MCP mostra erro de VPS offline sem inventar disponibilidade',async()=>{
 const s=await serverWith({vpsRequester:async()=>{throw Error('vps_http_503');}});
 try{const r=await invoke(s,'horizon_vps_health');assert.equal(r.connected,false);assert.equal(r.error,'vps_http_503');}finally{await s.close();}
});

[executed on device: srv2085016 (56be333d-f9c8-4f1e-8334-abe11feefac3)]