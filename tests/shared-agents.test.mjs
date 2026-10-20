import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {sharedAgentPreflight,startSharedAgents} from '../maestro/shared-agents.mjs';

const complete=Object.freeze({
  HORIZON_PY_AGENTS_ENABLED:'1',HORIZON_EXECUTOR_SHA:'a'.repeat(40),
  HORIZON_AGENT_ACTIONS_DISABLED:'1',
  GITHUB_TOKEN:'fake',HORIZON_SQLITE_ENCRYPTION_KEY:'fake',
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
