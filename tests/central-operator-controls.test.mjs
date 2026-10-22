import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {submitDirectTask,directTasks,directTaskAction,directRoot} from '../maestro/direct-queue.mjs';

test('owner can reorder, configure and reversibly remove tasks without deleting results',async()=>{
 const original=process.env.HORIZON_DIRECT_INBOX_DIR;
 const root=await mkdtemp(join(tmpdir(),'horizon-control-test-'));
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  for(const id of ['ctl-a-one','ctl-b-two','ctl-c-three']){
   await submitDirectTask({task_id:id,project:'romaneio-digital',repository:'danielnep/romaneio-digital',
    agent:'may-maestro',objective:'Auditar o fluxo inteiro sem alterar dados existentes',
    priority:'P2',delivery_type:'existing_product',allowed_paths:['src/**'],public_data_confirmed:true});
  }
  assert.deepEqual((await directTasks()).filter(t=>t.inQueue).map(t=>t.id),['ctl-a-one','ctl-b-two','ctl-c-three']);
  await directTaskAction('ctl-c-three','up');
  assert.deepEqual((await directTasks()).filter(t=>t.inQueue).map(t=>t.id),['ctl-a-one','ctl-c-three','ctl-b-two']);
  await directTaskAction('ctl-c-three','priority',{priority:'P0'});
  await directTaskAction('ctl-c-three','assign',{agent:'qa-engineer'});
  const change=(await directTasks()).find(t=>t.id==='ctl-c-three');
  assert.equal(change.priority,'P0');
  assert.equal(change.agent,'qa-engineer');
  const stored=JSON.parse(await readFile(join(directRoot(),'requests','ctl-c-three.json'),'utf8'));
  assert.match(stored.objective,/^P0 \| /);
  await assert.rejects(()=>directTaskAction('ctl-c-three','assign',{agent:'unknown'}),/agente_invalido/);
  const removed=await directTaskAction('ctl-c-three','archive');
  assert.equal(removed.status,'arquivada');
  assert.equal((await directTasks()).some(t=>t.id==='ctl-c-three'),false);
  const archived=(await directTasks({includeArchived:true})).find(t=>t.id==='ctl-c-three');
  assert.equal(archived.status,'arquivada');
  const restored=await directTaskAction('ctl-c-three','restore');
  assert.equal(restored.status,'pausada');
  assert.equal((await directTasks()).find(t=>t.id==='ctl-c-three').status,'pausada');
  await mkdir(join(root,'results'),{recursive:true});
  await writeFile(join(root,'results','ctl-c-three.json'),JSON.stringify({status:'pending'}));
  await assert.rejects(()=>directTaskAction('ctl-c-three','priority',{priority:'P1'}),/tarefa_ja_iniciada/);
 }finally{
  if(original===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;
  else process.env.HORIZON_DIRECT_INBOX_DIR=original;
  await rm(root,{recursive:true,force:true});
 }
});

test('queue edits reject invalid identifiers and unsupported commands',async()=>{
 await assert.rejects(()=>directTaskAction('../../files','archive'),/comando_invalido/);
 await assert.rejects(()=>directTaskAction('ctl-valid','destroy'),/comando_invalido/);
});

test('agent settings enforce repository and pending-task limits',async()=>{
 const prior=process.env.HORIZON_DIRECT_INBOX_DIR;
 const root=await mkdtemp(join(tmpdir(),'horizon-agent-config-'));
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  const {setAgentSettings,agentSettings}=await import('../maestro/direct-queue.mjs');
  await setAgentSettings('qa-engineer',{maxPending:1,allowedRepositories:['danielnep/romaneio-digital'],notes:'Testar regras'});
  assert.equal((await agentSettings('qa-engineer')).maxPending,1);
  const task={project:'romaneio-digital',repository:'danielnep/romaneio-digital',agent:'qa-engineer',
   objective:'Inspecionar fila e proteger histórico',priority:'P2',
   delivery_type:'existing_product',allowed_paths:['src/**'],public_data_confirmed:true};
  await assert.rejects(()=>submitDirectTask({...task,repository:'danielnep/horizon-site'}),/agente_nao_habilitado_no_projeto/);
  await submitDirectTask({...task,task_id:'ctl-settings-01'});
  await assert.rejects(()=>submitDirectTask({...task,task_id:'ctl-settings-02'}),/limite_da_fila_do_agente/);
  await assert.rejects(()=>setAgentSettings('qa-engineer',{maxPending:-2}),/configuracao_invalida/);
 }finally{
  if(prior===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;else process.env.HORIZON_DIRECT_INBOX_DIR=prior;
  await rm(root,{recursive:true,force:true});
 }
});

test('manual holds survive release of a different agent-level suspension',async()=>{
 const prior=process.env.HORIZON_DIRECT_INBOX_DIR;
 const root=await mkdtemp(join(tmpdir(),'horizon-hold-origin-'));
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  const {directAgentAction}=await import('../maestro/direct-queue.mjs');
  const input={project:'romaneio-digital',repository:'danielnep/romaneio-digital',agent:'qa-engineer',
   objective:'Preservar suspensões individuais durante liberação do agente',
   priority:'P2',delivery_type:'existing_product',allowed_paths:['src/**'],public_data_confirmed:true};
  await submitDirectTask({...input,task_id:'ctl-held-manual'});
  await submitDirectTask({...input,task_id:'ctl-held-automatic'});
  await directTaskAction('ctl-held-manual','pause');
  await directAgentAction('qa-engineer','pause');
  const before=await directTasks();
  assert.equal(before.find(x=>x.id==='ctl-held-manual').status,'pausada');
  assert.equal(before.find(x=>x.id==='ctl-held-automatic').status,'pausada');
  await directAgentAction('qa-engineer','resume');
  const after=await directTasks();
  assert.equal(after.find(x=>x.id==='ctl-held-manual').status,'pausada');
  assert.equal(after.find(x=>x.id==='ctl-held-automatic').inQueue,true);
 }finally{
  if(prior===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;else process.env.HORIZON_DIRECT_INBOX_DIR=prior;
  await rm(root,{recursive:true,force:true});
 }
});

test('edit a not-started task and move it to an exact queue position',async()=>{
 const prior=process.env.HORIZON_DIRECT_INBOX_DIR;
 const root=await mkdtemp(join(tmpdir(),'horizon-task-editor-'));
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 try{
  const input={project:'romaneio-digital',repository:'danielnep/romaneio-digital',agent:'may-maestro',
   objective:'Inspecionar aplicativo com cobertura suficiente',priority:'P2',
   delivery_type:'existing_product',allowed_paths:['src/**'],public_data_confirmed:true};
  await submitDirectTask({...input,task_id:'ctl-edit-one'});
  await submitDirectTask({...input,task_id:'ctl-edit-two'});
  await directTaskAction('ctl-edit-two','move',{position:1});
  assert.equal((await directTasks()).filter(x=>x.inQueue)[0].id,'ctl-edit-two');
  await directTaskAction('ctl-edit-one','edit',{objective:'Revisar responsividade mantendo os fluxos principais'});
  const stored=JSON.parse(await readFile(join(root,'requests','ctl-edit-one.json'),'utf8'));
  assert.match(stored.objective,/^P2 \| Revisar responsividade/);
  await assert.rejects(()=>directTaskAction('ctl-edit-one','move',{position:0}),/posicao_invalida/);
 }finally{
  if(prior===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;else process.env.HORIZON_DIRECT_INBOX_DIR=prior;
  await rm(root,{recursive:true,force:true});
 }
});

test('authenticated central API manages agent settings and preserves archived tasks',async()=>{
 const {startServer}=await import('../server.mjs');
 const {once}=await import('node:events');
 const prior={dir:process.env.HORIZON_DIRECT_INBOX_DIR,token:process.env.HORIZON_CONTROL_PASSWORD};
 const root=await mkdtemp(join(tmpdir(),'horizon-api-admin-'));
 process.env.HORIZON_DIRECT_INBOX_DIR=root;
 process.env.HORIZON_CONTROL_PASSWORD='local-test-only-strong-secret-value';
 const server=startServer({listenPort:0,background:false});
 try{
  await once(server,'listening');
  const port=server.address().port,url='http://127.0.0.1:'+port,origin='https://127.0.0.1:'+port;
  const headers={'content-type':'application/json',origin};
  const login=await fetch(url+'/central/api/login',{method:'POST',headers,body:JSON.stringify({password:'local-test-only-strong-secret-value'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const protectedHeaders={...headers,cookie};
  const id='ctl-config-api';
  await submitDirectTask({task_id:id,project:'horizon-site',repository:'danielnep/horizon-site',
   agent:'qa-engineer',objective:'Validar painel e permissões administrativas por API',
   priority:'P2',delivery_type:'existing_product',allowed_paths:['central/**'],public_data_confirmed:true});
  assert.equal((await fetch(url+'/central/api/agents/qa-engineer/config')).status,401);
  const policy=await fetch(url+'/central/api/agents/qa-engineer/config',{method:'POST',headers:protectedHeaders,
   body:JSON.stringify({maxPending:2,allowedRepositories:['danielnep/horizon-site'],notes:'Apenas teste'})});
  assert.equal(policy.status,200);
  assert.equal((await policy.json()).maxPending,2);
  const edit=await fetch(url+'/central/api/tasks/'+id+'/action',{method:'POST',headers:protectedHeaders,
   body:JSON.stringify({action:'edit',objective:'Revalidar visualmente os fluxos administrativos em celulares com teclado'})});
  assert.equal(edit.status,200);
  const archive=await fetch(url+'/central/api/tasks/'+id+'/action',{method:'POST',headers:protectedHeaders,
   body:JSON.stringify({action:'archive'})});
  assert.equal(archive.status,200);
  const archived=await fetch(url+'/central/api/tasks/archived',{headers:{cookie}});
  assert.equal(archived.status,200);
  assert.equal((await archived.json()).tasks.find(x=>x.id===id).status,'arquivada');
  const restore=await fetch(url+'/central/api/tasks/'+id+'/action',{method:'POST',headers:protectedHeaders,
   body:JSON.stringify({action:'restore'})});
  assert.equal(restore.status,200);
 }finally{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  if(prior.dir===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;else process.env.HORIZON_DIRECT_INBOX_DIR=prior.dir;
  if(prior.token===undefined)delete process.env.HORIZON_CONTROL_PASSWORD;else process.env.HORIZON_CONTROL_PASSWORD=prior.token;
  await rm(root,{recursive:true,force:true});
 }
});
