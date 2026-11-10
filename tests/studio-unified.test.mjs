import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async name=>readFile(new URL('../central/'+name,import.meta.url),'utf8');

test('The merged Studio has ONE native shell and eight visible workbench destinations',async()=>{
 const shell=await load('studio-shell.mjs');
 for(const x of ["preview:'Prévia'","chat:'Conversar'","maestra:'Maestra'","builder:'Construtor'","operations:'Operação'","quality:'Qualidade'","agents:'Agentes'","library:'Ferramentas'"]){
  assert.ok(shell.includes(x),'Missing '+x);
 }
 for(const pane of ['preview','chat','builder','operations','quality','agents','library']){
  assert.ok(shell.includes('id="hz-pane-'+pane+'"'),pane+' panel missing');
 }
 assert.match(shell,/shell\.querySelectorAll\('\[data-hz-tab\],\[data-go\]'\)/);
 assert.match(shell,/next=\(i\+1\)%tabs\.length/);
 assert.match(shell,/next=\(i\+tabs\.length-1\)%tabs\.length/);
 assert.doesNotMatch(shell,/<dialog id="hs-tools"/);
});

test('The merged Studio reuses real old tools, preserves project context, and does not resurrect old agents',async()=>{
 const app=await load('app.js');
 assert.match(app,/studioShellMarkup\(studioApps,tools,operations,quality\)/);
 for(const feature of ['wireframeMarkup()','requestForm()','pageTarefas()','pageHistorico()','pageConsumo()','pageSistema()','pageEvidencias()']){
  assert.ok(app.includes(feature),'Missing '+feature);
 }
 for(const agent of ['maestra','iris','lume','forja','mosaico','tatil','elo','argos']){
  assert.match(app,new RegExp(agent+":'"));
 }
 assert.match(app,/selectedAgentId='maestra'/);
 assert.doesNotMatch(app,/selectedAgentId='may-maestro'/);
 assert.match(app,/studioForceRender/);
});

test('The merged Studio catalog is VPS first, preserves source-only projects and does not expose a second password',async()=>{
 const api=await load('controller.mjs');
 const chat=await load('studio-chat.mjs');
 assert.match(api,/const STUDIO_PROJECTS=Object\.freeze/);
 assert.match(api,/const linked=new Set\(apps\.map/);
 assert.match(api,/if\(linked\.has\(repo\.repository\)\)continue/);
 assert.match(chat,/A sessão deste dispositivo expirou/);
 assert.doesNotMatch(chat,/prompt\(.{0,50}senha/i);
});
