import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {startServer} from '../server.mjs';

test('R3 is the only initial Studio UI, including legacy hash routes',async()=>{
 const server=startServer({listenPort:0,background:false});await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port+'/central/';
 try{
  for(const path of ['', '#estudio', '#inicio']){
   const r=await fetch(base+path);assert.equal(r.status,200);
   const html=await r.text();
   assert.match(html,/id="studio"/);
   assert.match(html,/id="conversation-panel"/);
   assert.match(html,/id="preview-frame"/);
   assert.match(html,/\.\/studio-r3\.css\?v=[a-f0-9]{16}/);
   assert.match(html,/\.\/studio-r3\.mjs\?v=[a-f0-9]{16}/);
   assert.doesNotMatch(html,/Carregando a central|id="shell"|studio-shell\.css|src="\.\/app\.js"/);
  }
  assert.equal((await fetch(base+'studio-r3.mjs')).status,200);
  assert.equal((await fetch(base+'studio-r3.css')).status,200);
 }finally{server.closeAllConnections?.();await new Promise(done=>server.close(done));}
});

test('R3 private file explorer denies unauthorized access even when panel is passwordless',async()=>{
 const old={panel:process.env.HORIZON_PANEL_ONLY,secret:process.env.HORIZON_CONTROL_PASSWORD};
 process.env.HORIZON_PANEL_ONLY='true';
 process.env.HORIZON_CONTROL_PASSWORD='test-only-r3-owner-secret-123456789';
 const server=startServer({listenPort:0,background:false});await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const url=base+'/central/api/studio/files?repository=danielnep/horizon-site&path=';
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url.replace('/files','/file')+'README.md')).status,401);
  const stamp=String(Date.now());
  const sig=createHmac('sha256',process.env.HORIZON_CONTROL_PASSWORD).update('horizon-control:v1:studio-invite:'+stamp).digest('base64url');
  const unlock=await fetch(base+'/central/api/studio/unlock',{method:'POST',headers:{origin:'https://127.0.0.1:'+server.address().port,'content-type':'application/json'},body:JSON.stringify({invite:stamp+'.'+sig})});
  assert.equal(unlock.status,200);
  const cookie=(unlock.headers.get('set-cookie')||'').split(';')[0];assert.match(cookie,/horizon_studio=/);
  for(const bad of ['../etc','/etc/passwd','.env','src/token.js']){
   const response=await fetch(url+encodeURIComponent(bad),{headers:{cookie}});
   assert.equal(response.status,400,bad);
  }
 }finally{
  server.closeAllConnections?.();await new Promise(done=>server.close(done));
  for(const [key,val] of [['HORIZON_PANEL_ONLY',old.panel],['HORIZON_CONTROL_PASSWORD',old.secret]]){
   if(val===undefined)delete process.env[key];else process.env[key]=val;
  }
 }
});
