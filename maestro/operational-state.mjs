// Read the encrypted operational SQLite snapshot without ever rewriting it.
// The legacy May-owned JSON remains authoritative for May handoff receipts;
// operational activity is separately verified, not fabricated as a new checkpoint.
import {createDecipheriv, createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {CHECKPOINT_FRESH_MAX_AGE_MS} from './checkpoint.mjs';

const BRANCH=/^agent-state\/railway-[a-z0-9-]{2,36}$/;
const SHA=/^[a-f0-9]{40}$/;
const MAX_BLOB=12_000_000,MAX_DATABASE=64*1024*1024;
const COUNTS=['queued','running','succeeded','failed','blocked'];
const REPO='danielnep/May-Maestro-Executor';
const PATH='runtime/state.sqlite3.gz';
const SCRIPT=fileURLToPath(new URL('./operational-state.py',import.meta.url));

function safeUnavailable(reason){
 return {status:'unavailable',reason};
}
function base64url(buffer){
 // Python urlsafe_b64encode keeps its padding; dropping "=" changes the key.
 return buffer.toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
}

export function decryptOperationalBlob(blob,privatePem){
 if(!Buffer.isBuffer(blob)||!Buffer.isBuffer(privatePem)||blob.length>MAX_BLOB)
  throw Error('invalid_blob');
 const material=base64url(createHash('sha256')
  .update(Buffer.concat([Buffer.from('horizon-railway-key-v1:'),privatePem])).digest());
 const key=createHash('sha256').update('horizon-github-sqlite-v1:'+material).digest();
 // Fernet: 0x80 | uint64 timestamp | 16-byte IV | AES-128-CBC | HMAC-SHA256.
 if(!/^[A-Za-z0-9_-]+=*$/.test(blob.toString('ascii')))
  throw Error('invalid_fernet_encoding');
 const token=Buffer.from(blob.toString('ascii'),'base64url');
 if(token.length<73||token[0]!==0x80||(token.length-57)%16!==0)
  throw Error('invalid_fernet_token');
 const data=token.subarray(0,token.length-32);
 const actual=token.subarray(token.length-32);
 const expected=createHmac('sha256',key.subarray(0,16)).update(data).digest();
 if(!timingSafeEqual(actual,expected))throw Error('fernet_signature_invalid');
 const decipher=createDecipheriv('aes-128-cbc',key.subarray(16),token.subarray(9,25));
 const compressed=Buffer.concat([decipher.update(token.subarray(25,token.length-32)),decipher.final()]);
 const sqlite=gunzipSync(compressed,{maxOutputLength:MAX_DATABASE});
 if(sqlite.length<100||!sqlite.subarray(0,16).equals(Buffer.from('SQLite format 3\0')))
  throw Error('sqlite_header_invalid');
 return sqlite;
}

export async function inspectSqlite(sqlite,{launch=spawn,timeoutMs=15000}={}){
 return new Promise((resolve,reject)=>{
  let child;
  try{child=launch('python3',['-I',SCRIPT],{
   stdio:['pipe','pipe','ignore'],
   env:{PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1'}
  });}catch{reject(Error('observer_launch_failed'));return;}
  let stdout='',finished=false;
  const finish=(err,value)=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   if(err)reject(err);else resolve(value);
  };
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('observer_timeout'));},timeoutMs);
  child.on('error',()=>finish(Error('observer_launch_failed')));
  child.stdout.on('data',buf=>{
   stdout+=buf.toString('utf8');
   if(stdout.length>4096){child.kill('SIGKILL');finish(Error('observer_output_oversized'));}
  });
  child.on('close',code=>{
   if(code!==0)return finish(Error('observer_exit_failed'));
   try{finish(null,JSON.parse(stdout));}
   catch{finish(Error('observer_output_invalid'));}
  });
  child.stdin.on('error',()=>{}); // EPIPE is reported as a nonzero child exit.
  child.stdin.end(sqlite);
 });
}

function validateReport(input,now){
 if(input?.schema!==1||!Number.isSafeInteger(input.task_count)||input.task_count<0)
  throw Error('observer_schema_invalid');
 const counts={};let total=0;
 for(const key of COUNTS){
  const count=input.task_counts?.[key];
  if(!Number.isSafeInteger(count)||count<0)throw Error('observer_counts_invalid');
  counts[key]=count;total+=count;
 }
 if(total!==input.task_count)throw Error('observer_count_mismatch');
 const parseTime=value=>{
  if(value===null)return null;
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value))throw Error('observer_time_invalid');
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))throw Error('observer_time_invalid');
  return d.toISOString();
 };
 const lastEventAt=parseTime(input.last_event_at);
 const lastSuccessEventAt=parseTime(input.last_success_event_at);
 if(lastEventAt&&lastSuccessEventAt&&Date.parse(lastSuccessEventAt)>Date.parse(lastEventAt))
  throw Error('observer_order_invalid');
 const age=lastEventAt?now.getTime()-Date.parse(lastEventAt):null;
 const eventRecency=age===null?'unknown':age < -300000?'invalid_future':
  age>CHECKPOINT_FRESH_MAX_AGE_MS?'stale':'recent';
 return {taskCount:input.task_count,taskCounts:counts,lastEventAt,lastSuccessEventAt,
  eventRecency,eventAgeMinutes:age===null?null:Math.floor(Math.max(0,age)/60000)};
}

export async function loadOperationalState({env=process.env,fetcher=fetch,
 readKey=readFile,keyStat=stat,inspector=inspectSqlite,now=new Date()}={}){
 if(env.HORIZON_PY_AGENTS_ENABLED!=='1')return {status:'disabled'};
 const branch=env.HORIZON_STATE_BRANCH;
 if(!BRANCH.test(branch||'')||!env.GITHUB_TOKEN)
  return safeUnavailable('observer_configuration_missing');
 try{
  const path=join(env.RAILWAY_VOLUME_MOUNT_PATH||'/data','horizon-checkpoint-migration-private.pem');
  const metadata=await keyStat(path);
  if(!metadata.isFile()||(metadata.mode&0o077)!==0)
   return safeUnavailable('observer_key_unsafe');
  const privatePem=await readKey(path);
  const response=await fetcher('https://api.github.com/repos/'+REPO+
   '/contents/'+PATH+'?ref='+encodeURIComponent(branch),{
   headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
   signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)return safeUnavailable('observer_github_http_'+response.status);
  const body=await response.json();
  if(body?.encoding!=='base64'||!SHA.test(body.sha||'')||
   typeof body.content!=='string'||body.content.length>MAX_BLOB*2)
   return safeUnavailable('observer_blob_metadata_invalid');
  const encrypted=Buffer.from(body.content.replace(/\s/g,''),'base64');
  if(encrypted.length>MAX_BLOB||!encrypted.length)
   return safeUnavailable('observer_blob_size_invalid');
  const computed=createHash('sha1').update(Buffer.from('blob '+encrypted.length+'\0'))
   .update(encrypted).digest('hex');
  if(computed!==body.sha)return safeUnavailable('observer_blob_sha_mismatch');
  const sqlite=decryptOperationalBlob(encrypted,privatePem);
  const info=validateReport(await inspector(sqlite),now);
  return {status:'verified',source:'github-encrypted-sqlite',branch,snapshotSha:computed,...info};
 }catch{
  // Fail closed. No secrets, URL query, task content or stack traces in logs.
  return safeUnavailable('observer_read_failed');
 }
}
