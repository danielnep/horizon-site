import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {startServer} from '../server.mjs';
import {vpsStudioApps,vpsStudioPreview} from '../central/controller.mjs';

test('Studio catalog is VPS domains, not Github Pages',()=>{
 const apps=vpsStudioApps();
 assert.equal(apps.length,5);
 assert.equal(apps.find(a=>a.id==='ronda-pro')?.url,'https://maxvel.hzsys.tech/');
 for(const app of apps){
  assert.match(app.url,/^https:\/\/[a-z0-9-]+\.hzsys\.tech\/$/);
  assert.equal(app.source,'vps');
  assert.doesNotMatch(app.url,/github\.io|github\.com/);
 }
});
test('VPS Studio refuses unknown app IDs rather than falling back to Github',async()=>{
 const invalid=await vpsStudioPreview('nonexistent');
 assert.equal(invalid.ready,false);
 assert.equal(invalid.source,'vps');
 assert.equal(invalid.url,undefined);
});
test('public Studio API gives VPS catalog and does not use Github API',async()=>{
 const server=startServer({listenPort:0,background:false});
 await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const list=await fetch(base+'/central/api/studio/apps');
  assert.equal(list.status,200);
  const payload=await list.json();
  assert.equal(payload.source,'vps');
  assert.equal(payload.apps.find(a=>a.id==='ronda-pro').url,'https://maxvel.hzsys.tech/');
  for(const id of ['','http://internal','unknown_app']){
   const res=await fetch(base+'/central/api/studio/preview?appId='+encodeURIComponent(id));
   const result=await res.json();
   assert.equal(result.ready,false);
  }
  const script=await readFile(new URL('../central/studio.mjs',import.meta.url),'utf8');
  assert.match(script,/\/central\/api\/studio\/preview\?appId=/);
  assert.doesNotMatch(script,/\/central\/api\/preview\?repository=/);
 }finally{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
 }
});
