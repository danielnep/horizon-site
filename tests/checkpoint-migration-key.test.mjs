import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicKey,publicEncrypt,privateDecrypt,constants} from 'node:crypto';
import {migrationKey} from '../maestro/checkpoint-migration-key.mjs';
import {startServer} from '../server.mjs';

test('private migration key stays in one protected volume; public key is stable',()=>{
 const volume=mkdtempSync(join(tmpdir(),'horizon-rsa-test-'));
 try{
  assert.equal(migrationKey({volume,env:{}}),null);
  const a=migrationKey({volume,env:{HORIZON_MEMORY_BRIDGE_ENABLED:'1'}});
  const b=migrationKey({volume,env:{HORIZON_MEMORY_BRIDGE_ENABLED:'1'}});
  assert.equal(a.fingerprint,b.fingerprint);
  assert.match(a.publicKey,/BEGIN PUBLIC KEY/);
  assert.equal(statSync(a.privatePath).mode&0o777,0o600);
  const msg=Buffer.from('synthetic task checkpoint');
  const encrypted=publicEncrypt({key:a.publicKey,oaepHash:'sha256'},msg);
  assert.deepEqual(privateDecrypt({key:readFileSync(a.privatePath),oaepHash:'sha256'},encrypted),msg);
  assert.ok(!JSON.stringify(a).includes('BEGIN PRIVATE KEY'));
 }finally{rmSync(volume,{recursive:true,force:true});}
});

test('public migration endpoint defaults unavailable and never exposes private keys',async()=>{
 const server=startServer({listenPort:0,background:false,reader:async()=>Buffer.from('ok')});
 await new Promise(resolve=>server.once('listening',resolve));
 try{
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/internal/horizon-checkpoint-public-key');
  assert.equal(res.status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
