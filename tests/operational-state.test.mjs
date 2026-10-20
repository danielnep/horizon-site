import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {decryptOperationalBlob,loadOperationalState} from '../maestro/operational-state.mjs';
import {runSupervisorCycle} from '../maestro-worker.mjs';
import {createFileHandoffStore,registerHandoff} from '../maestro/handoff-store.mjs';

const NOW=new Date('2026-10-20T06:30:00Z');
const BRANCH='agent-state/railway-staging';
const SECRET=Buffer.from('synthetic-test-key-material-not-a-real-key');
const SQLITE=Buffer.concat([Buffer.from('SQLite format 3\0'),Buffer.alloc(128)]);
const COUNTS={queued:7,running:1,succeeded:2,failed:0,blocked:1};

function base64url(bytes){
 return bytes.toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
}
function encryptLikePythonFernet(raw,privatePem=SECRET){
 const material=base64url(createHash('sha256').update(Buffer.concat([
  Buffer.from('horizon-railway-key-v1:'),privatePem
 ])).digest());
 const key=createHash('sha256').update('horizon-github-sqlite-v1:'+material).digest();
 const header=Buffer.alloc(9);header[0]=0x80;header.writeBigUInt64BE(1n,1);
 const iv=randomBytes(16);
 const cipher=createCipheriv('aes-128-cbc',key.subarray(16),iv);
 const encrypted=Buffer.concat([cipher.update(gzipSync(raw)),cipher.final()]);
 const signed=Buffer.concat([header,iv,encrypted]);
 const mac=createHmac('sha256',key.subarray(0,16)).update(signed).digest();
 return Buffer.from(base64url(Buffer.concat([signed,mac])));
}
function snapshotResponse(blob){
 const sha=createHash('sha1').update(Buffer.from('blob '+blob.length+'\0'))
  .update(blob).digest('hex');
 return {ok:true,json:async()=>({encoding:'base64',sha,content:blob.toString('base64')})};
}
const inspect=async bytes=>{
 assert.deepEqual(bytes,SQLITE);
 return {schema:1,task_count:11,task_counts:COUNTS,
  last_event_at:'2026-10-20T06:25:00Z',
  last_success_event_at:'2026-10-20T05:30:00Z'};
};

test('Fernet derives exact padded Python key and rejects any MAC mutation',()=>{
 const encrypted=encryptLikePythonFernet(SQLITE);
 assert.deepEqual(decryptOperationalBlob(encrypted,SECRET),SQLITE);
 const token=Buffer.from(encrypted.toString(),'base64url');
 token[26]^=0x01;
 assert.throws(()=>decryptOperationalBlob(Buffer.from(base64url(token)),SECRET),/fernet_signature_invalid/);
 assert.throws(()=>decryptOperationalBlob(encrypted,Buffer.from('wrong-key')),/fernet_signature_invalid/);
});

test('reads verified operational snapshot on independent Railway state branch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'horizon-observe-key-'));
 try{
  const keyPath=join(dir,'horizon-checkpoint-migration-private.pem');
  await writeFile(keyPath,SECRET,{mode:0o600});
  const encrypted=encryptLikePythonFernet(SQLITE);
  let calls=0;
  const state=await loadOperationalState({env:{
   HORIZON_PY_AGENTS_ENABLED:'1',HORIZON_STATE_BRANCH:BRANCH,
   GITHUB_TOKEN:'synthetic-secret',RAILWAY_VOLUME_MOUNT_PATH:dir
  },fetcher:async(url,options)=>{
   calls++;
   assert.equal(options.headers.Authorization,'Bearer synthetic-secret');
   assert.match(url,/%2Frailway-staging/);
   return snapshotResponse(encrypted);
  },inspector:inspect,now:NOW});
  assert.equal(calls,1);
  assert.equal(state.status,'verified');
  assert.equal(state.eventRecency,'recent');
  assert.equal(state.taskCount,11);
  assert.equal(state.taskCounts.succeeded,2);
  assert.equal(state.lastEventAt,'2026-10-20T06:25:00.000Z');
  assert.equal(state.snapshotSha,createHash('sha1')
   .update(Buffer.from('blob '+encrypted.length+'\0')).update(encrypted).digest('hex'));
  assert.equal(JSON.stringify(state).includes('synthetic-secret'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('end-to-end decrypts and inspects a real synthetic SQLite via Python',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'horizon-observe-real-'));
 try{
  const db=join(dir,'synthetic.sqlite3');
  const key=join(dir,'horizon-checkpoint-migration-private.pem');
  const py=spawnSync('python3',['-c',
   'import sqlite3,sys,time\n'+
   'db=sqlite3.connect(sys.argv[1])\n'+
   'db.execute("CREATE TABLE tasks(status TEXT, secret TEXT)")\n'+
   'db.execute("CREATE TABLE events(kind TEXT, created_at REAL)")\n'+
   'db.execute("INSERT INTO tasks VALUES(?,?)",("succeeded","hidden-client-secret"))\n'+
   'db.execute("INSERT INTO events VALUES(?,?)",("succeeded",1792477500))\n'+
   'db.commit();db.close()\n',db],{encoding:'utf8',timeout:10000});
  assert.equal(py.status,0,py.stderr);
  await writeFile(key,SECRET,{mode:0o600});
  const encrypted=encryptLikePythonFernet(await readFile(db));
  const state=await loadOperationalState({
   env:{HORIZON_PY_AGENTS_ENABLED:'1',HORIZON_STATE_BRANCH:BRANCH,
    GITHUB_TOKEN:'mock',RAILWAY_VOLUME_MOUNT_PATH:dir},
   fetcher:async()=>snapshotResponse(encrypted),now:NOW
  });
  assert.equal(state.status,'verified');
  assert.equal(state.taskCount,1);
  assert.equal(state.taskCounts.succeeded,1);
  assert.equal(JSON.stringify(state).includes('hidden-client-secret'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('invalid branch or blob SHA fails closed without declaring success',async()=>{
 const disabled=await loadOperationalState({env:{HORIZON_PY_AGENTS_ENABLED:'0'}});
 assert.equal(disabled.status,'disabled');
 const invalid=await loadOperationalState({env:{
  HORIZON_PY_AGENTS_ENABLED:'1',HORIZON_STATE_BRANCH:'agent-state/runtime',
  GITHUB_TOKEN:'abc'
 },fetcher:async()=>{throw Error('should not fetch')}});
 assert.equal(invalid.status,'unavailable');
 const encrypted=encryptLikePythonFernet(SQLITE);
 const unavailable=await loadOperationalState({env:{
   HORIZON_PY_AGENTS_ENABLED:'1',HORIZON_STATE_BRANCH:BRANCH,
   GITHUB_TOKEN:'synthetic',RAILWAY_VOLUME_MOUNT_PATH:'/unused'
  },
  keyStat:async()=>({isFile:()=>true,mode:0o600}),readKey:async()=>SECRET,
  fetcher:async()=>({ok:true,json:async()=>({
   encoding:'base64',sha:'0'.repeat(40),content:encrypted.toString('base64')})}),
  inspector:async()=>{throw Error('should not inspect')}});
 assert.equal(unavailable.status,'unavailable');
 assert.equal(unavailable.reason,'observer_blob_sha_mismatch');
});

test('old JSON checkpoint stays stale while verified SQLite activity is reported independently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'horizon-observe-handoff-'));
 try{
  const store=createFileHandoffStore({file:join(dir,'handoffs.json')});
  const handoffId='6fc0de12-34ab-4567-8901-1234567890ab';
  await store.write(registerHandoff(await store.read(),{
   decisionAt:'2026-10-19T09:00:00Z',
   nextCallAt:'2026-10-19T10:30:00Z',
   checkpointExecutionId:'historical'
  },{id:handoffId}));
  const checkpoint={schema_version:2,updated_at:'2026-10-18T19:41:35.193Z',
   last_execution:{id:'historical',verification:'old proof'},projects:[]};
  const logs=[];
  await assert.rejects(()=>runSupervisorCycle({
   fetcher:async()=>({ok:true,text:async()=>JSON.stringify(checkpoint)}),
   clock:()=>NOW,handoffStore:store,log:line=>logs.push(line),
   operationalReader:async()=>({status:'verified',branch:BRANCH,
    snapshotSha:'a'.repeat(40),taskCount:11,taskCounts:COUNTS,
    eventRecency:'recent',eventAgeMinutes:5,
    lastEventAt:'2026-10-20T06:25:00Z',
    lastSuccessEventAt:'2026-10-20T05:30:00Z'}),
   priorityQueueLoader:async()=>({status:'verified',tasks:[],highest:null}),
   gemini:async()=>{throw Error('Gemini HTTP 429');}
  }),/Gemini HTTP 429/);
  const persisted=await store.read();
  assert.equal(persisted.lastObservation.checkpointRecencyStatus,'stale');
  assert.equal(persisted.lastObservation.operational.eventRecency,'recent');
  assert.equal(persisted.lastObservation.operational.taskCount,11);
  assert.equal(persisted.handoffs[0].status,'overdue');
  assert.equal(logs.some(x=>x.startsWith('[maestro-handoff] ')),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
