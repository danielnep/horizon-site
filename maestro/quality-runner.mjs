// May Maestro autonomous QA runner. No Gemini dependency, no repository writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {MaestroMemory} from './memory-store.mjs';
const exec=promisify(execFile);
export const PROJECTS=Object.freeze({
  'maestro':{repo:'danielnep/horizon-site',stages:[
    {id:'syntax-server',command:'node',args:['--check','server.mjs'],timeoutMs:25000},
    {id:'syntax-worker',command:'node',args:['--check','maestro-worker.mjs'],timeoutMs:25000},
    {id:'unit-regression',command:'npm',args:['test'],timeoutMs:180000}
  ]},
  'ronda-pro':{repo:'danielnep/app-hondas-maxvel',stages:[
    {id:'source-check',command:'npm',args:['run','check'],timeoutMs:120000},
    {id:'unit-regression',command:'npm',args:['test'],timeoutMs:240000}
  ]},
  'romaneio-digital':{repo:'danielnep/romaneio-digital',stages:[
    {id:'syntax-server',command:'node',args:['--check','server.js'],timeoutMs:25000},
    {id:'unit-regression',command:'npm',args:['test'],timeoutMs:240000}
  ]}
});
const TRANSIENT=/\b(ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|503|504|429|network timeout|temporary failure)\b/i;
export function redact(s){
 return String(s||'').replace(/AIza[\w-]{16,}/g,'[REDACTED]')
 .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"'\\]+/ig,'$1[REDACTED]')
 .replace(/(password|token|api[_-]?key|secret)(\s*[:=]\s*)[^\s"'\\]+/ig,'$1$2[REDACTED]')
 .slice(-3000);
}
export async function runCommand(spec,{cwd,invoke=exec}={}){
 const at=Date.now();
 try{
  const result=await invoke(spec.command,spec.args,{cwd,timeout:spec.timeoutMs,windowsHide:true,maxBuffer:1024*1024,env:{...process.env,CI:'1'}});
  return {ok:true,durationMs:Date.now()-at,exitCode:0,log:redact((result.stdout||'')+'\n'+(result.stderr||''))};
 }catch(err){
  const msg=(err.stdout||'')+'\n'+(err.stderr||'')+'\n'+String(err.message||'');
  return {ok:false,durationMs:Date.now()-at,exitCode:Number.isInteger(err.code)?err.code:null,
    transient:TRANSIENT.test(msg),log:redact(msg)};
 }
}
export async function runProject({project,root,invoke=exec,now=()=>new Date(),reportPath=null,memoryRoot=null,log=console.log}={}){
 if(!Object.hasOwn(PROJECTS,project))throw new Error('Projeto nao autorizado: '+String(project));
 if(!root||typeof root!=='string')throw new Error('Root obrigatorio');
 const workdir=resolve(root);
 const config=PROJECTS[project],startedAt=now().toISOString(),stages=[];
 // Run distinct validation layers, without allowing AI-generated shell commands.
 for(const stage of config.stages){
  const attempts=[];let result;
  for(let i=0;i<2;i++){
   result=await runCommand(stage,{cwd:workdir,invoke});
   attempts.push({index:i+1,...result});
   if(result.ok||!result.transient)break; // Never "retry until green" for deterministic code errors.
  }
  stages.push({id:stage.id,passed:result.ok,attempts});
  log('[maestro-quality] '+JSON.stringify({project,stage:stage.id,passed:result.ok,attempts:attempts.length}));
 }
 let head=null;
 try{const ref=await readFile(resolve(workdir,'.git/HEAD'),'utf8');head=ref.trim().slice(0,100)}catch{}
 const report={schema:1,agent:'may-maestro-quality-runner',project,repo:config.repo,startedAt,endedAt:now().toISOString(),
  headReference:head,status:stages.every(x=>x.passed)?'pass':'fail',stages,
  nextAction:stages.every(x=>x.passed)?'Aguardar alteracoes ou proxima verificacao':'Abrir investigacao: reproduzir primeiro teste falho, formular causa, corrigir em branch isolada, retestar e revisar diff'};
 if(reportPath){
  const file=resolve(reportPath);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 }
 if(memoryRoot){
   const store=new MaestroMemory(memoryRoot);
   const safeRunId=String(process.env.GITHUB_RUN_ID||'local').replace(/[^a-z0-9._-]/ig,'').slice(0,32);
   const safeAttempt=String(process.env.GITHUB_RUN_ATTEMPT||'1').replace(/[^a-z0-9._-]/ig,'').slice(0,12);
   const id='qa-'+project+'-'+safeRunId+'-'+safeAttempt;
   await store.append({id,repo:config.repo,kind:'test',summary:report.status+'; '+stages.map(s=>s.id+':'+(s.passed?'ok':'failed')).join(', ').slice(0,1500),evidence:'CI automated '+(process.env.GITHUB_SERVER_URL||'local')+'/'+(process.env.GITHUB_REPOSITORY||config.repo)+'/actions/runs/'+safeRunId,at:report.endedAt});
 }
 return report;
}
export function summarize(report){
 return [('# Maestro QA | '+report.project),('Resultado: '+report.status),('Repo: '+report.repo),
 ...report.stages.map(x=>'- '+x.id+': '+(x.passed?'PASS':'FAIL')+' ('+x.attempts.length+' tentativa(s))'),
 'Proxima acao: '+report.nextAction].join('\n');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')&&x.includes('=')).map(x=>x.slice(2).split(/=(.*)/s).slice(0,2)));
 runProject({project:args.project,root:args.root,reportPath:args.out,memoryRoot:process.env.MAESTRO_MEMORY_ROOT||null}).then(async report=>{
  const s=summarize(report);
  console.log(s);
  if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,s+'\n',{flag:'a'});
  if(report.status!=='pass')process.exitCode=1;
 }).catch(e=>{console.error('[maestro-quality-error] '+String(e.message||e));process.exitCode=2});
}