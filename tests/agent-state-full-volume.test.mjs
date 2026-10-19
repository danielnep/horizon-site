import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {hasMigrationHeadroom, readStoredSnapshot} from '../maestro/embedded-postgres.mjs';

function fakePg({compact=null,legacy=null}) {
  return {
    calls: [],
    async query(sql) {
      this.calls.push(sql);
      if (sql.includes('to_regclass')) return {rows:[{compact:compact?'horizon_agent_snapshots_compact':null,legacy:legacy?'horizon_agent_snapshots':null}]};
      if (sql.includes('FROM horizon_agent_snapshots_compact')) return {rows:compact?[compact]:[]};
      if (sql.includes('FROM horizon_agent_snapshots WHERE')) return {rows:legacy?[legacy]:[]};
      throw Error('Unexpected SQL');
    }
  };
}
function item(data,compressed=false) {
  const source=Buffer.from(data);
  return {revision:19,snapshot:(compressed?gzipSync(source):source).toString('base64'),
    checksum:createHash('sha256').update(source).digest('hex')};
}
test('under full 500 MB volume, migration and VACUUM are not attempted',()=>{
  assert.equal(hasMigrationHeadroom({bavail:1000,bsize:16384}),false);
  assert.equal(hasMigrationHeadroom({bavail:4096,bsize:16384}),true);
});
test('legacy snapshot remains recoverable with zero writes after partial migration',async()=>{
  const legacy=item('durable legacy checkpoint');
  const pg=fakePg({legacy});
  const result=await readStoredSnapshot(pg);
  assert.deepEqual(result,legacy);
  assert.equal(pg.calls.length,2);
  assert(pg.calls.every(sql=>/^SELECT/.test(sql)));
});
test('when compact exists and has a valid row, it takes precedence',async()=>{
  const raw='verified persisted checkpoint';
  const compact=item(raw,true);
  const pg=fakePg({compact,legacy:item('stale checkpoint')});
  const result=await readStoredSnapshot(pg);
  assert.deepEqual(result,item(raw));
  assert.equal(pg.calls.length,2);
});
test('partial migration with empty compact table falls back to legacy',async()=>{
  const legacy=item('recover old original');
  const pg=fakePg({legacy,compact:null});
  // Simulate an installed empty compact table, followed by legacy data.
  const prior=pg.query.bind(pg);
  pg.query=async(sql)=>{
    if(sql.includes('to_regclass')) return {rows:[{compact:'horizon_agent_snapshots_compact',legacy:'horizon_agent_snapshots'}]};
    return prior(sql);
  };
  assert.deepEqual(await readStoredSnapshot(pg),legacy);
});
test('never return corrupted bytes as valid checkpoint',async()=>{
  const legacy={...item('good'),checksum:'0'.repeat(64)};
  await assert.rejects(readStoredSnapshot(fakePg({legacy})),/integrity mismatch/);
});
test('empty new state returns empty, not invented checkpoint',async()=>{
  assert.deepEqual(await readStoredSnapshot(fakePg({})),{revision:0,snapshot:null,checksum:null});
});
