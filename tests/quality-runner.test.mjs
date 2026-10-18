import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PROJECTS,runProject,redact,runCommand,summarize} from '../maestro/quality-runner.mjs';
test('catalogo fechado de projetos conhecidos',()=>{
 assert.deepEqual(Object.keys(PROJECTS).sort(),['maestro','romaneio-digital','ronda-pro']);
});
test('nao executa comando passado pela IA nem repositorio fora do catalogo',async()=>{
 await assert.rejects(()=>runProject({project:'rm -rf /',root:'/tmp',invoke:()=>{throw Error('Nao executar')}}),/nao autorizado/);
});
test('camadas independentes executadas, memoria do teste serializada',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'maestro-qa-'));
 try{
  const calls=[];
  const report=await runProject({project:'maestro',root:temp,reportPath:join(temp,'evidence','report.json'),
   now:()=>new Date('2026-10-17T12:00:00.000Z'),log:()=>{},
   invoke:async(cmd,args)=>{calls.push([cmd,...args]);return {stdout:'Passed',stderr:''};}});
  assert.equal(report.status,'pass');assert.equal(report.stages.length,3);assert.equal(calls.length,3);
  const saved=JSON.parse(await readFile(join(temp,'evidence','report.json'),'utf8'));
  assert.equal(saved.schema,1);assert.equal(saved.repo,'danielnep/horizon-site');assert.match(summarize(report),/PASS/);
 }finally{await rm(temp,{recursive:true,force:true})}
});
test('erro de codigo nao repete cegamente, segue demais validacoes',async()=>{
 let count=0;
 const out=await runProject({project:'romaneio-digital',root:'/tmp',log:()=>{},
 invoke:async()=>{count++;const e=Error('Assertion failed');e.code=1;throw e;}});
 assert.equal(out.status,'fail');assert.equal(out.stages[0].attempts.length,1);
 assert.equal(out.stages[1].attempts.length,1);assert.equal(count,2);
});
test('falha de rede transitoria repete uma vez e registra ambas',async()=>{
 let count=0;
 const out=await runProject({project:'romaneio-digital',root:'/tmp',log:()=>{},
 invoke:async()=>{count++;if(count===1){const e=Error('EAI_AGAIN');e.code=1;throw e;}return {stdout:'ok',stderr:''}}});
 assert.equal(out.status,'pass');assert.equal(out.stages[0].attempts.length,2);assert.equal(count,3);
});
test('segredos nao entram em relatorio',()=>{
 const input='GEMINI_API_KEY=abcd12345678 token=secretstring API_KEY=whatever Authorization: Bearer abcde';
 const safe=redact(input);assert.doesNotMatch(safe,/secretstring|whatever|Bearer abcde/);
});
test('nao expande shells nem caminhos arbitrarios do modelo',async()=>{
 const cmds=[];
 await runCommand({command:'node',args:['--version'],timeoutMs:10},{cwd:'/tmp',
 invoke:async(cmd,args,options)=>{cmds.push({cmd,args,options});return {stdout:'v22',stderr:''}}});
 assert.equal(cmds[0].cmd,'node');assert.deepEqual(cmds[0].args,['--version']);assert.equal(cmds[0].options.cwd,'/tmp');
});
