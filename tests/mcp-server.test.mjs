import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleHorizonMcp} from '../maestro/mcp-server.mjs';
const KEY='local-test-auth-token';
async function serverWith({githubToken,fetcher}={}){
 const server=http.createServer((q,r)=>handleHorizonMcp(q,r,{token:KEY,githubToken,fetcher}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {url:`http://127.0.0.1:${server.address().port}/mcp`,close:()=>new Promise(done=>server.close(done))};
}
async function call(url,method,params={},auth=KEY,origin){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream',...(auth?{'authorization':`Bearer ${auth}`} :{}),...(origin?{origin}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 return {status:r.status,body:await r.json()};
}
test('rejeita acesso nao autenticado, origem desconhecida e aceita inicializacao',async()=>{
 const s=await serverWith();try{
  assert.equal((await call(s.url,'tools/list',{},null)).status,401);
  assert.equal((await call(s.url,'tools/list',{},KEY,'https://evil.example')).status,403);
  const i=await call(s.url,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(i.status,200);assert.equal(i.body.result.protocolVersion,'2025-11-25');
  const l=await call(s.url,'tools/list');assert.equal(l.body.result.tools.length,4);
 }finally{await s.close();}
});
test('lista agentes, valida parametros, sem segredo nao escreve',async()=>{
 const s=await serverWith();try{
  const a=await call(s.url,'tools/call',{name:'horizon_list_agents',arguments:{}});
  assert.equal(JSON.parse(a.body.result.content[0].text).count,17);
  const b=await call(s.url,'tools/call',{name:'horizon_submit_task',arguments:{task_id:'task-aaa',project:'demo-projeto',agent:'may-maestro',objective:'Ler docs e gerar testes publicos',public_data_confirmed:false}});
  assert.equal(b.body.result.isError,true);
  const c=await call(s.url,'tools/call',{name:'horizon_submit_task',arguments:{task_id:'task-aaa',project:'demo-projeto',agent:'may-maestro',objective:'Ler docs e gerar testes publicos',public_data_confirmed:true}});
  assert.equal(c.body.result.isError,true);
 }finally{await s.close();}
});
test('submissao autenticada com escopo minimo e hash de commit',async()=>{
 let written;
 const fetcher=async(url,opts)=>{
  if(opts.method==='PUT'){written=JSON.parse(opts.body);return {ok:true,status:201,json:async()=>({commit:{sha:'123abc'}})};}
  return {ok:false,status:404};
 };
 const s=await serverWith({githubToken:'not-real-test-token',fetcher});
 try{
  const r=await call(s.url,'tools/call',{name:'horizon_submit_task',arguments:{task_id:'task-aaa',project:'demo-projeto',agent:'backend-engineer',objective:'Criar modulo de teste sem dados reais',public_data_confirmed:true,allowed_paths:['apps/demo-projeto/**']}});
  const v=JSON.parse(r.body.result.content[0].text);
  assert.equal(v.status,'submitted');assert.equal(v.commit,'123abc');
  assert.equal(JSON.parse(Buffer.from(written.content,'base64').toString()).payload.allowed_paths[0],'apps/demo-projeto/**');
 }finally{await s.close();}
});