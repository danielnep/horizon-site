import test from 'node:test';
import assert from 'node:assert/strict';
import {splitTaskPlan,taskPlanStatus} from '../central/task-steps.mjs';

test('objetivo longo vira lista de atividades legíveis',()=>{
 const parts=splitTaskPlan('1. Revisar a interface\n2. Ajustar botões\n3. Executar testes');
 assert.deepEqual(parts,['Revisar a interface','Ajustar botões','Executar testes']);
});
test('não marca como concluído sem associação verificável',()=>{
 const sections=splitTaskPlan('1. Cadastro\n2. Mapa\n3. Testes');
 let statuses=taskPlanStatus(sections,[{state:'completed',agent:'qa-engineer'}]);
 assert.equal(statuses.every(x=>x.verified===false),true);
 statuses=taskPlanStatus(sections,[{state:'completed',agent:'frontend-engineer'},
  {state:'running',agent:'backend-engineer'},{state:'failed',agent:'qa-engineer'}]);
 assert.equal(statuses[0].verified,true);
 assert.equal(statuses[1].verified,false);
 assert.equal(statuses[2].verified,false);
});
test('servidor publica módulo do planejamento para a interface',async()=>{
 const {startServer}=await import('../server.mjs');
 const {once}=await import('node:events');
 const server=startServer({listenPort:0,background:false});await once(server,'listening');
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/central/task-steps.mjs');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/javascript/);
  assert.match(await response.text(),/splitTaskPlan/);
 }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});

test('parágrafo único com oito resultados exibe oito etapas do executor, mesmo sem lista no pedido',async()=>{
 const source=await (await import('node:fs/promises')).readFile(new URL('../central/app.js',import.meta.url),'utf8');
 assert.match(source,/recordedStages\.length>1/);
 assert.match(source,/recordedStages\.map/);
 const stages=Array.from({length:8},(_,i)=>({summary:'Etapa '+(i+1),state:i<2?'completed':'pending',agent:'qa-engineer'}));
 const writtenPlan=splitTaskPlan('Reformule o painel Studio Horizon e valide a interface.');
 const items=writtenPlan.length>1?writtenPlan:stages.length>1?stages.map(x=>x.summary):writtenPlan;
 const result=taskPlanStatus(items,stages);
 assert.equal(result.length,8);
 assert.equal(result.filter(x=>x.verified).length,2);
 assert.equal(result[3].verified,false);
});
