// Generate a single-use import key INSIDE the Railway service's own volume.
// Only the public key is ever exposed. Private material never leaves /data.
import {generateKeyPairSync, createHash, createPublicKey} from 'node:crypto';
import {mkdirSync, openSync, closeSync, writeFileSync, readFileSync, statSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';

const FILENAME='horizon-checkpoint-migration-private.pem';

export function migrationKey({env=process.env,volume=env.RAILWAY_VOLUME_MOUNT_PATH||'/data'}={}) {
  if(env.HORIZON_MEMORY_BRIDGE_ENABLED!=='1')return null;
  mkdirSync(volume,{recursive:true});
  const path=join(volume,FILENAME);
  let privatePem;
  try{
    privatePem=readFileSync(path,'utf8');
  }catch(e){
    if(e?.code!=='ENOENT')throw e;
    const pair=generateKeyPairSync('rsa',{
      modulusLength:3072,publicExponent:0x10001,
      publicKeyEncoding:{format:'pem',type:'spki'},
      privateKeyEncoding:{format:'pem',type:'pkcs8'}
    });
    let fd;
    try{
      fd=openSync(path,'wx',0o600);
      writeFileSync(fd,pair.privateKey,{encoding:'utf8'});
    }catch(error){
      if(error?.code!=='EEXIST')throw error;
      privatePem=readFileSync(path,'utf8');
    }finally{if(fd!==undefined)closeSync(fd);}
    if(!privatePem)privatePem=pair.privateKey;
  }
  if((statSync(path).mode & 0o077)!==0)throw Error('migration_private_key_permissions_unsafe');
  const publicPem=createPublicKey(privatePem).export({format:'pem',type:'spki'}).toString();
  const fingerprint=createHash('sha256').update(publicPem).digest('hex');
  return Object.freeze({publicKey:publicPem,fingerprint,privatePath:path});
}
