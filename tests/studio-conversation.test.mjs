import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHmac} from 'node:crypto';
import {startServer} from '../server.mjs';

test('Studio requires real owner access even with the public panel enabled',async()=>{
 const previous={panel:process.env.HORIZON_PANEL_ONLY,secret:process.env.HORIZON_CONTROL_PASSWORD};
 process.env.HORIZON_PANEL_ONLY='true';process.env.HORIZON_CONTROL_PASSWORD='test-only-studio-secret-32-characters';
 const server=startServer({listenPort:0,background:false});await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const origin='https://127.0.0.1:'+server.address().port;
 const signed=(purpose,stamp)=>createHmac('sha256',process.env.HORIZON_CONTROL_PASSWORD).update('horizon-control:v1:'+purpose+':'+stamp).digest('base64url');
 try{
  const session=await (await fetch(base+'/central/api/studio/session')).json();
  assert.equal(session.authenticated,false);
  for(const path of ['agents','projects/fluxo/messages']){
   assert.equal((await fetch(base+'/central/api/studio/'+path)).status,401);
  }
  const send=(payload,from=origin)=>fetch(base+'/central/api/studio/unlock',{method:'POST',headers:{'content-type':'application/json',origin:from},body:JSON.stringify(payload)});
  assert.equal((await send({password:process.env.HORIZON_CONTROL_PASSWORD},'https://evil.example')).status,403);
  assert.equal((await send({})).status,401);
  assert.equal((await send({password:''})).status,401);
  assert.equal((await send({password:process.env.HORIZON_CONTROL_PASSWORD})).status,401);
  assert.equal((await send({invite:'123.invalid'})).status,401);
  const expired=String(Date.now()-3600001);
  assert.equal((await send({invite:expired+'.'+signed('studio-invite',expired)})).status,401);
  const stamp=String(Date.now());
  const access=await send({invite:stamp+'.'+signed('studio-invite',stamp)});
  assert.equal(access.status,200);
  const cookie=access.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
  assert.equal((await (await fetch(base+'/central/api/studio/session',{headers:{cookie:cookie.split(';')[0]}})).json()).authenticated,true);
  const denied=await fetch(base+'/central/api/studio/projects/fluxo/messages',{method:'POST',headers:{cookie:cookie.split(';')[0],'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify({message:'test'})});
  assert.equal(denied.status,403);
  for(const file of ['studio-r3.mjs','studio-r3.css']){
   assert.equal((await fetch(base+'/central/'+file)).status,200);
  }
 }finally{
  server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
  if(previous.panel===undefined)delete process.env.HORIZON_PANEL_ONLY;else process.env.HORIZON_PANEL_ONLY=previous.panel;
  if(previous.secret===undefined)delete process.env.HORIZON_CONTROL_PASSWORD;else process.env.HORIZON_CONTROL_PASSWORD=previous.secret;
 }
});
