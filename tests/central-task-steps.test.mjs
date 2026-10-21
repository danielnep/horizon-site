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
