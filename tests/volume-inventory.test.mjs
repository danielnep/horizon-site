import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectVolume} from '../maestro/volume-inventory.mjs';

test('read-only volume inventory classifies legacy database and redacts unknown paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'horizon-volume-audit-'));
 try{
  await mkdir(join(root,'horizon-agents-postgres','pg_wal'),{recursive:true});
  await writeFile(join(root,'horizon-agents-postgres','pg_wal','000000000000000000000001'),Buffer.alloc(8192));
  await writeFile(join(root,'sensitive-client-file.txt'),'private');
  await writeFile(join(root,'maestro-supervisor-handoffs.json'),'{}');
  await symlink(join(root,'sensitive-client-file.txt'),join(root,'indirect-secret'));
  const result=await inspectVolume({root});
  assert.equal(result.fileCount,3);
  assert.equal(result.symlinksSkipped,1);
  assert.ok(result.groups.some(x=>x.name==='horizon-agents-postgres'));
  assert.ok(result.groups.some(x=>x.name==='[other-redacted]'));
  assert.ok(result.largest.some(x=>x.path.includes('pg_wal')));
  assert.ok(!JSON.stringify(result).includes('sensitive-client-file'));
  assert.ok(!JSON.stringify(result).includes('indirect-secret'));
  assert.ok(result.capacityMB>=result.usedMB);
 }finally{await rm(root,{recursive:true,force:true});}
});
