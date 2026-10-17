import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MaestroMemory,validateEvent} from '../maestro/memory-store.mjs';
const item={id:'run-20261017-0001',repo:'danielnep/horizon-site',kind:'test',summary:'Node 22 CI aprovado',evidence:'Actions: run 100',at:'2026-10-17T23:00:00.000Z'};
test('memoria append-only sobrevive reabertura e busca por repositorio',async()=>{
 const root=await mkdtemp(join(tmpdir(),'may-memory-'));
 try{
  const a=new MaestroMemory(root);
  assert.equal((await a.append(item)).created,true);
  const b=new MaestroMemory(root);
  assert.equal((await b.find({repo:item.repo}))[0].summary,item.summary);
  assert.equal((await b.append(item)).created,false);
  assert.equal((await b.find({kind:'test',query:'Actions'})).length,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('mesmo ID com payload divergente nao sobrescreve',async()=>{
 const root=await mkdtemp(join(tmpdir(),'may-memory-'));
 try{
  const m=new MaestroMemory(root);await m.append(item);
  await assert.rejects(()=>m.append({...item,summary:'falso aprovado'}),/Conflito/);
  assert.equal((await m.find({}))[0].summary,item.summary);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('recusa segredo e conteudo fora do contrato',()=>{
 assert.throws(()=>validateEvent({...item,evidence:'sk-proj-aaaaaaaaaaaaaaaa'}),/segredo/i);
 assert.throws(()=>validateEvent({...item,repo:'someone-else/other'}),/Repo/);
 assert.throws(()=>validateEvent({...item,kind:'delete-production'}),/Tipo/);
});
test('encontra varias memorias sem apagar contexto antigo',async()=>{
 const root=await mkdtemp(join(tmpdir(),'may-memory-'));
 try{
  const m=new MaestroMemory(root);
  await m.append(item);
  await m.append({...item,id:'run-20261017-0002',kind:'decision',summary:'Corrigir fonte',at:'2026-10-17T23:10:00.000Z'});
  const all=await m.find({limit:200});assert.equal(all.length,2);assert.equal(all[0].kind,'decision');
 }finally{await rm(root,{recursive:true,force:true})}
});
