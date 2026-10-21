import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {sharedAgentPreflight,startSharedAgents,startCheckpointImport} from '../maestro/shared-agents.mjs';

const complete=Object.freeze({
  HORIZON_PY_AGENTS_ENABLED:'1',HORIZON_EXECUTOR_SHA:'a'.repeat(40),
  HORIZON_AGENT_ACTIONS_DISABLED:'1',HORIZON_STATE_BRANCH:'agent-state/railway-staging',
  GITHUB_TOKEN:'fake',
  KERNEL_API_KEY:'fake',GEMINI_API_KEY:'fake'
});

test('default inactive: no Python process and no new Railway service',()=>{
  assert.deepEqual(sharedAgentPreflight({}),{ready:false,reason:'disabled',missing:[]});
  let launches=0;
  const stop=startSharedAgents({env:{},launch:()=>{launches++;throw Error('not allowed');}});
  assert.equal(launches,0); stop();
});
test('missing key, pinned SHA or exclusive writer refuses start',()=>{
  const config={...complete};
  delete config.KERNEL_API_KEY;
  delete config.HORIZON_AGENT_ACTIONS_DISABLED;
  const p=sharedAgentPreflight(config);
  assert.equal(p.ready,false);
  assert.ok(p.missing.includes('KERNEL_API_KEY'));
  assert.ok(p.missing.includes('HORIZON_AGENT_ACTIONS_DISABLED'));
  let launches=0,lines=[];
  startSharedAgents({env:config,launch:()=>{launches++;},log:x=>lines.push(x)});
  assert.equal(launches,0);
  assert.match(lines[0],/configuration_missing/);
  assert.ok(!lines[0].includes('fake'));
});
test('a single bounded Python child receives secrets only in environment',()=>{
  const p=new EventEmitter();
  p.stdout=new PassThrough();
  p.stderr=new PassThrough();
  p.kill=signal=>{p.killed=signal;};
  const calls=[],logs=[];
  const stop=startSharedAgents({env:complete,
    launch:(file,args,options)=>{calls.push({file,args,options});return p;},
    log:x=>logs.push(x),err:x=>logs.push(x)});
  assert.equal(calls.length,1);
  assert.equal(calls[0].file,'python3');
  assert.deepEqual(calls[0].args.slice(0,1),['-u']);
  assert.equal(calls[0].options.env.KERNEL_API_KEY,'fake');
  assert.equal(calls[0].options.env.HORIZON_STATE_BACKEND,'github-sqlite');
  assert.ok(!calls[0].args.join(' ').includes('fake'));
  p.stdout.write('[team-railway] preflight_verified {"count":17}\n');
  p.stdout.write('SECRET_KEY=should_never_relay\n');
  assert.ok(logs.some(x=>x.includes('preflight_verified')));
  assert.ok(!logs.some(x=>x.includes('should_never_relay')));
  stop();
  assert.equal(p.killed,'SIGTERM');
});
test('unexpected exit retries only ONE child and stops on shutdown',()=>{
  const instances=[],timers=[],cancelled=[];
  function spawn(){
    const p=new EventEmitter();
    p.stdout=new PassThrough();p.stderr=new PassThrough();
    p.kill=()=>{};
    instances.push(p);return p;
  }
  const stop=startSharedAgents({env:complete,launch:spawn,
    log:()=>{},err:()=>{},
    schedule:(fn,ms)=>{timers.push({fn,ms});return {unref(){}};},
    cancel:id=>cancelled.push(id)});
  instances[0].emit('exit',1,null);
  assert.equal(timers.length,1);
  assert.equal(timers[0].ms,300000);
  timers[0].fn();
  assert.equal(instances.length,2);
  stop();
});


test('one-time memory import is inert without an artifact and starts once when armed',()=>{
  let launches=0;const logs=[];
  const idle=startCheckpointImport({env:{},launch:()=>{launches++;throw Error('unexpected')}});
  assert.equal(launches,0);idle();
  const env={HORIZON_MEMORY_BRIDGE_ENABLED:'1',HORIZON_MEMORY_ARTIFACT_ID:'12244142446',
    HORIZON_PY_AGENTS_ENABLED:'0',GITHUB_TOKEN:'synthetic',
    HORIZON_EXECUTOR_SHA:'a'.repeat(40)};
  const process=new EventEmitter();
  process.stdout=new PassThrough();process.stderr=new PassThrough();
  process.kill=signal=>{process.closed=signal;};
  const stop=startCheckpointImport({env,launch:(bin,args,opt)=>{
    launches++;assert.equal(bin,'python3');
    assert.ok(args.some(a=>a.endsWith('railway-checkpoint-import.py')));
    assert.ok(!args.join(' ').includes('synthetic'));
    return process;
  },log:m=>logs.push(m)});
  assert.equal(launches,1);
  process.stdout.write('[team-railway] migration_blocked {"reason":"checkpoint_changed_since_export"}\\n');
  assert.ok(logs.some(s=>s.includes('import_attempt_started')));
  stop();
  assert.equal(process.closed,'SIGTERM');
});

for(const key of ['GROQ_API_KEY','API_IA_GROQ']) {
  test('Groq-only preflight accepts '+key,()=>{
    const env={...complete,[key]:'synthetic'};
    delete env.GEMINI_API_KEY;
    assert.equal(sharedAgentPreflight(env).ready,true);
  });
}
