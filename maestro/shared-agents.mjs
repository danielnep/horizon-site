// One bounded Python supervisor for 17 logical specialists INSIDE Horizon's
// EXISTING Railway service. Never creates 17 processes, browsers or volumes.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SCRIPT=fileURLToPath(new URL('./railway-team.py',import.meta.url));
const REQUIRED=Object.freeze([
  'GITHUB_TOKEN','HORIZON_STATE_BRANCH'
]);

export function sharedAgentPreflight(env=process.env) {
  if(env.HORIZON_PY_AGENTS_ENABLED!=='1')
    return {ready:false,reason:'disabled',missing:[]};
  const missing=REQUIRED.filter(name=>!env[name]);
  if(!env.HORIZON_EXECUTOR_SHA || !/^[0-9a-f]{40}$/.test(env.HORIZON_EXECUTOR_SHA))
    missing.push('HORIZON_EXECUTOR_SHA');
  if(!/^agent-state\/railway-[a-z0-9-]{2,36}$/.test(env.HORIZON_STATE_BRANCH||''))
    missing.push('HORIZON_STATE_BRANCH_FORMAT');
  if(env.HORIZON_AGENT_ACTIONS_DISABLED!=='1')
    missing.push('HORIZON_AGENT_ACTIONS_DISABLED');
  if(!(env.GEMINI_API_KEY||env.GROQ_API_KEY||env.API_IA_GROQ))
    missing.push('GEMINI_API_KEY_OR_GROQ_API_KEY');
  return {ready:missing.length===0,reason:missing.length?'configuration_missing':'ready',missing};
}


export function startCheckpointImport({env=process.env,launch=spawn,
  log=console.log,err=console.error}={}) {
  if(env.HORIZON_MEMORY_BRIDGE_ENABLED!=='1'
     || !/^[1-9][0-9]{4,15}$/.test(env.HORIZON_MEMORY_ARTIFACT_ID||'')
     || env.HORIZON_PY_AGENTS_ENABLED==='1')return ()=>{};
  if(!env.GITHUB_TOKEN || !/^[a-f0-9]{40}$/.test(env.HORIZON_EXECUTOR_SHA||'')){
    err('[horizon-migration] configuration_missing');
    return ()=>{};
  }
  const file=fileURLToPath(new URL('./railway-checkpoint-import.py',import.meta.url));
  const child=launch('python3',['-u',file],{
    env:{...env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']
  });
  const emit=chunk=>{
    for(const line of String(chunk).split('\n')){
      if(line.startsWith('[team-railway] migration_') &&
         !/secret|password|token=|Bearer /i.test(line))
        log(line.slice(0,360));
    }
  };
  child.stdout?.on('data',emit);
  child.stderr?.on('data',emit);
  child.on('error',()=>err('[horizon-migration] process_launch_failed'));
  child.on('exit',(code)=>log('[horizon-migration] exited '+JSON.stringify({code})));
  log('[horizon-migration] import_attempt_started');
  return ()=>{child.kill('SIGTERM')};
}

export function startSharedAgents({env=process.env,launch=spawn,log=console.log,
  err=console.error,schedule=setTimeout,cancel=clearTimeout}={}) {
  let closing=false,child=null,timer=null,attempts=0;
  const cfg=sharedAgentPreflight(env);
  if(cfg.reason==='disabled')return ()=>{};
  if(!cfg.ready){
    log('[horizon-team] not_started '+JSON.stringify({reason:cfg.reason,missing:cfg.missing}));
    return ()=>{};
  }
  function start() {
    if(closing || child)return;
    // Never include tokens, auth URLs or task content in a child command line.
    const worker=launch('python3',['-u',SCRIPT],{
      env:{...env,HORIZON_STATE_BACKEND:'github-sqlite',PYTHONDONTWRITEBYTECODE:'1'},
      stdio:['ignore','pipe','pipe']
    });
    child=worker;
    log('[horizon-team] started '+JSON.stringify({workers:1,agents:17,storage:'github_encrypted_sqlite'}));
    const emit=(line,level='log')=>{
      // Whitelisted machine statuses only; do not relay arbitrary Python tracebacks.
      for(const item of String(line).split('\n')) {
        if(item.startsWith('[team-railway] ')){
          const msg=item.slice(15,360);
          if(!/secret|token|password|key=|Bearer /i.test(msg))
            (level==='error'?err:log)('[horizon-team] '+msg);
        }
      }
    };
    worker.stdout?.on('data',s=>emit(s));
    worker.stderr?.on('data',s=>emit(s,'error'));
    worker.on('error',e=>{err('[horizon-team] launch_error '+String(e?.code||'unknown'));});
    worker.on('exit',(code,signal)=>{
      if(child!==worker)return;
      child=null;
      if(closing)return;
      attempts+=1;
      err('[horizon-team] exited '+JSON.stringify({code,signal,retrySeconds:300}));
      timer=schedule(start,300000);
      timer?.unref?.();
    });
  }
  start();
  return ()=>{
    closing=true;
    if(timer!==null)cancel(timer);
    if(child)child.kill('SIGTERM');
  };
}
