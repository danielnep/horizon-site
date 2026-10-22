import test from 'node:test';
import assert from 'node:assert/strict';
import {
 vpsConnectionConfig,disconnectedVps,normalizeVpsSnapshot,
 vpsRequest,vpsSnapshot,vpsSubmitTask,vpsTaskAction,vpsAgentAction
} from '../central/vps-client.mjs';

const env={HORIZON_VPS_API_URL:'https://control.vps.example/',HORIZON_VPS_API_TOKEN:'test-secret'};
const ids=['may-maestro','qa-engineer'];
const pack={
 source:'vps',at:'2026-10-22T15:00:00Z',
 agents:[{id:'qa-engineer',status:'Trabalhando',currentTask:'ctl-12345',updatedAt:'2026-10-22T15:00:00Z'}],
 tasks:[{id:'ctl-12345',project:'ronda-pro',title:'Ajustar GPS',inQueue:true,
  status:'em execução',lastActivity:{at:'2026-10-22T15:00:00Z',agent:'qa-engineer',action:'run_check'},
  progress:null,stages:[{agent:'qa-engineer',state:'running'}]}],
 worker:{status:'executando',lastCycle:null},
 available:{queue:true,results:true,attendance:true},
 usage:{available:true,input:310,output:78,total:388,calls:2,days:7,
 byAgent:{'qa-engineer':{total:388}},byProvider:{groq:{total:388}}},
 events:[{event:'task_started',kind:'worker',at:'2026-10-22T15:00:00Z'}],
 activity:[{action:'run_check',taskId:'ctl-12345',agent:'qa-engineer'}]
};
test('Unix socket mode stays local and uses a strong authenticated token',()=>{
 const config=vpsConnectionConfig({HORIZON_VPS_API_SOCKET:'/run/horizon-central/control.sock',
  HORIZON_VPS_API_TOKEN:'a'.repeat(64)});
 assert.equal(config.ok,true);
 assert.equal(config.socket,'/run/horizon-central/control.sock');
 assert.equal(vpsConnectionConfig({HORIZON_VPS_API_SOCKET:'/tmp/control.sock',
  HORIZON_VPS_API_TOKEN:'a'.repeat(64)}).ok,false);
 assert.equal(vpsConnectionConfig({HORIZON_VPS_API_SOCKET:'/run/horizon-central/control.sock',
  HORIZON_VPS_API_TOKEN:'weak'}).ok,false);
});
test('VPS configuration refuses missing token, plain HTTP and URL credentials',()=>{
 assert.equal(vpsConnectionConfig({}).ok,false);
 assert.equal(vpsConnectionConfig({...env,HORIZON_VPS_API_TOKEN:''}).ok,false);
 assert.equal(vpsConnectionConfig({...env,HORIZON_VPS_API_URL:'http://control.vps.example/'}).ok,false);
 assert.equal(vpsConnectionConfig({...env,HORIZON_VPS_API_URL:'https://someone:pwd@control.vps.example/'}).ok,false);
 assert.equal(vpsConnectionConfig(env).ok,true);
});
test('offline state is explicit; no old queue, tokens or successful statuses',()=>{
 const v=disconnectedVps('Sem ligação');
 assert.equal(v.available.vps,false);
 assert.equal(v.tasks.length,0);
 assert.equal(v.usage.total,null);
 assert.match(v.worker.status,/Sem ligação/);
});
test('VPS snapshot includes only recorded facts and gives missing agents unknown statuses',()=>{
 const v=normalizeVpsSnapshot(pack,ids);
 assert.equal(v.source,'VPS Hostinger');
 assert.equal(v.available.vps,true);
 assert.equal(v.agents[0].status,'sem telemetria individual');
 assert.equal(v.agents[1].currentTask,'ctl-12345');
 assert.equal(v.tasks[0].progress,null);
 assert.equal(v.tasks[0].lastActivity.action,'run_check');
 assert.equal(v.usage.total,388);
 assert.equal(v.events[0].event,'task_started');
});
test('invalid data without VPS source cannot appear live',()=>{
 assert.throws(()=>normalizeVpsSnapshot({agents:[],tasks:[]},ids),/resposta_vps_invalida/);
});
test('HTTP API calls use bearer token and validated paths, never Railway',async()=>{
 let seen=[];
 const fetcher=async(url,options)=>{
  seen.push({url,options});
  if(url.endsWith('/v1/snapshot'))return new Response(JSON.stringify(pack),{status:200});
  if(url.endsWith('/v1/tasks'))return new Response(JSON.stringify({id:'ctl-submitted',status:'enviada'}),{status:201});
  return new Response(JSON.stringify({id:'ctl-12345',status:'pausada'}),{status:200});
 };
 const settings={env,fetcher};
 const status=await vpsSnapshot(ids,settings);
 assert.equal(status.tasks.length,1);
 const task=await vpsSubmitTask({objective:'Ajustar o mapa'},settings);
 assert.equal(task.id,'ctl-submitted');
 await vpsTaskAction('ctl-12345','pause',settings);
 await vpsAgentAction('qa-engineer','pause',settings);
 assert.equal(seen.length,4);
 assert.ok(seen.every(x=>x.url.startsWith('https://control.vps.example/v1/')));
 assert.ok(seen.every(x=>x.options.headers.authorization==='Bearer test-secret'));
 assert.equal(seen[2].options.method,'POST');
 await assert.rejects(()=>vpsTaskAction('../etc/passwd','cancel',settings),/comando_invalido/);
 await assert.rejects(()=>vpsRequest('https://railway.app/v1/snapshot',settings),/rota_vps_invalida/);
});
test('upstream errors do not silently fall back to old local data',async()=>{
 await assert.rejects(()=>vpsSnapshot(ids,{env,fetcher:async()=>new Response('{}',{status:503})}),/vps_http_503/);
});
test('browser receives disconnected status without triggering development tasks',async()=>{
 const {startServer}=await import('../server.mjs');
 const {once}=await import('node:events');
 const server=startServer({listenPort:0,background:false});
 await once(server,'listening');
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const res=await fetch(base+'/central/api/overview');
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.available.vps,false);
  assert.equal(body.tasks.length,0);
  assert.equal(body.usage.total,null);
  const js=await fetch(base+'/central/app.js').then(x=>x.text());
  assert.match(js,/VPS desconectada/);
 }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});
