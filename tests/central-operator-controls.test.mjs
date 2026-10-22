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
