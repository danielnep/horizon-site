import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,access,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {retireLegacyVolume,retirementConfirmed,LEGACY_ARCHIVE_SHA256} from '../maestro/retire-legacy-volume.mjs';
import {startServer} from '../server.mjs';
const env={HORIZON_LEGACY_RETIRE_SHA256:LEGACY_ARCHIVE_SHA256};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'horizon-legacy-retire-'));
 const legacy=join(root,'horizon-agents-postgres');
 await mkdir(join(legacy,'base','5'),{recursive:true});
 await mkdir(join(legacy,'global')); await mkdir(join(legacy,'pg_wal'));
 await writeFile(join(legacy,'PG_VERSION'),'17\n');
 await writeFile(join(legacy,'base','5','16394'),Buffer.alloc(4096));
 await writeFile(join(legacy,'pg_wal','00001'),Buffer.alloc(4096));
 await writeFile(join(root,'maestro-supervisor-handoffs.json'),'{"version":1,"handoffs":[]}\n');
 return {root,legacy};
}
test('retirement is disabled until exact archive SHA and read-only legacy confirmed',async()=>{
 const {root,legacy}=await fixture();
 try{
  assert.equal(retirementConfirmed({}),false);
  assert.equal((await retireLegacyVolume({root,env:{},log:()=>{}})).status,'disabled');
  assert.equal((await retireLegacyVolume({root,env:{...env,HORIZON_LEGACY_STATE_WRITE:'1'},log:()=>{}})).status,'disabled');
  await access(join(legacy,'PG_VERSION'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('retire exact inactive legacy directory while preserving independent handoff state',async()=>{
 const {root,legacy}=await fixture();
 try{
  const before=await readFile(join(root,'maestro-supervisor-handoffs.json'),'utf8');
  const result=await retireLegacyVolume({root,env,log:()=>{}});
  assert.equal(result.status,'retired');
  assert.equal(result.removed,'horizon-agents-postgres');
  assert.equal(result.archivalSha256,LEGACY_ARCHIVE_SHA256);
  assert.equal(await readFile(join(root,'maestro-supervisor-handoffs.json'),'utf8'),before);
  assert.deepEqual(await readdir(root),['maestro-supervisor-handoffs.json']);
  assert.equal((await retireLegacyVolume({root,env,log:()=>{}})).status,'already_retired');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('refuse arbitrary path or symlink masquerading as legacy postgres',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-legacy-guard-'));
 const other=await mkdtemp(join(tmpdir(),'horizon-other-'));
 try{
  await mkdir(join(other,'base')); await mkdir(join(other,'global'));await mkdir(join(other,'pg_wal'));await writeFile(join(other,'PG_VERSION'),'17');
  await symlink(other,join(root,'horizon-agents-postgres'));
  await assert.rejects(()=>retireLegacyVolume({root,env}),/not a real directory/);
  await access(join(other,'PG_VERSION'));
 }finally{await rm(root,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});
test('legacy endpoint remains unchanged while not armed, reports retired when armed',async()=>{
 const before=process.env.HORIZON_LEGACY_RETIRE_SHA256;
 process.env.HORIZON_LEGACY_RETIRE_SHA256=LEGACY_ARCHIVE_SHA256;
 const srv=startServer({listenPort:0,background:false,reader:async()=>Buffer.from('<html>Horizon</html>')});
 await new Promise(resolve=>srv.once('listening',resolve));
 try{
  const base='http://127.0.0.1:'+srv.address().port;
  const status=await fetch(base+'/api/internal/horizon-agent-state');
  assert.equal(status.status,410);
  assert.equal((await status.json()).activeBackend,'github-encrypted-sqlite');
  assert.equal((await fetch(base+'/health')).status,200);
 }finally{
  await new Promise(resolve=>srv.close(resolve));
  if(before===undefined)delete process.env.HORIZON_LEGACY_RETIRE_SHA256;
  else process.env.HORIZON_LEGACY_RETIRE_SHA256=before;
 }
});
