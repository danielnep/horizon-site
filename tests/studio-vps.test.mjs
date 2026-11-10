import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {startServer} from '../server.mjs';
import {vpsStudioApps,vpsStudioPreview} from '../central/controller.mjs';

test('One project identity links VPS publication and repository, VPS entries first',()=>{
 const apps=vpsStudioApps();
 assert.equal(new Set(apps.map(a=>a.id)).size,apps.length);
 const repos=apps.map(a=>a.repository).filter(Boolean);
 assert.equal(new Set(repos).size,repos.length);
 const ronda=apps.find(a=>a.id==='ronda-pro');
 assert.equal(ronda.url,'https://maxvel.hzsys.tech/');
 assert.equal(ronda.repository,'danielnep/app-hondas-maxvel');
 const firstSourceOnly=apps.findIndex(a=>!a.url);
 assert.ok(firstSourceOnly>0);
 for(const app of apps.slice(0,firstSourceOnly)){
  assert.match(app.url,/^https:\/\/[a-z0-9-]+\.hzsys\.tech\/$/);
  assert.equal(app.source,'vps');
  assert.doesNotMatch(app.url,/github\.io|github\.com/);
 }
 assert.ok(apps.slice(firstSourceOnly).every(a=>!a.url));
 assert.equal(apps.find(a=>a.id==='horizon-studio').repository,'danielnep/horizon-site');
});
test('Unknown projects and unverified publications never fall back to Github',async()=>{
 for(const id of ['nonexistent','horizon-studio']){
  const invalid=await vpsStudioPreview(id);
  assert.equal(invalid.ready,false);assert.equal(invalid.source,'vps');assert.equal(invalid.url,undefined);
 }
});
test('Public catalog and Studio assets work without GitHub API; preview remains deployment-scoped',async()=>{
 const server=startServer({listenPort:0,background:false});await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const list=await fetch(base+'/central/api/studio/apps');assert.equal(list.status,200);
  const payload=await list.json();assert.equal(payload.count,payload.apps.length);
  assert.equal(payload.apps.find(a=>a.id==='fluxo').repository,'danielnep/sistema-fluxo-restaurantes');
  for(const file of ['studio-shell.mjs','studio-shell.css','studio-mark.svg'])assert.equal((await fetch(base+'/central/'+file)).status,200);
  for(const id of ['','http://internal','unknown_app'])assert.equal((await (await fetch(base+'/central/api/studio/preview?appId='+encodeURIComponent(id))).json()).ready,false);
  const script=await readFile(new URL('../central/studio.mjs',import.meta.url),'utf8');
  assert.match(script,/\/central\/api\/studio\/preview\?appId=/);
  assert.doesNotMatch(script,/\/central\/api\/preview\?repository=/);
 }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});
