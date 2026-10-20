// One bounded Python supervisor for 17 logical specialists INSIDE Horizon's
// EXISTING Railway service. Never creates 17 processes, browsers or volumes.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SCRIPT=fileURLToPath(new URL('./railway-team.py',import.meta.url));
const REQUIRED=Object.freeze([
  'GITHUB_TOKEN','HORIZON_SQLITE_ENCRYPTION_KEY','KERNEL_API_KEY'
]);

export function sharedAgentPreflight(env=process.env) {
  if(env.HORIZON_PY_AGENTS_ENABLED!=='1')
    return {ready:false,reason:'disabled',missing:[]};
  const missing=REQUIRED.filter(name=>!env[name]);
  if(!env.HORIZON_EXECUTOR_SHA || !/^[0-9a-f]{40}$/.test(env.HORIZON_EXECUTOR_SHA))
    missing.push('HORIZON_EXECUTOR_SHA');
  if(env.HORIZON_AGENT_ACTIONS_DISABLED!=='1')
    missing.push('HORIZON_AGENT_ACTIONS_DISABLED');
  if(!(env.GEMINI_API_KEY||env.DEEPSEEK_API_KEY))
    missing.push('GEMINI_API_KEY_OR_DEEPSEEK_API_KEY');
  return {ready:missing.length===0,reason:missing.length?'configuration_missing':'ready',missing};
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
