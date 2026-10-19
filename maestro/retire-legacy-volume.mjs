import {lstat,readdir,rm,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// SHA-256 of the logical SQLite snapshot recovered from the PGlite archive.
// Owner holds the independently decryptable AES-GCM/RSA backup outside Railway.
export const LEGACY_ARCHIVE_SHA256='324b49bf4bffcf12e7c68295b436d002f70cfea02018d8f40f376c14894fab6b';
export const retirementConfirmed=(env=process.env)=>
  env.HORIZON_LEGACY_RETIRE_SHA256===LEGACY_ARCHIVE_SHA256 &&
  env.HORIZON_LEGACY_STATE_WRITE!=='1';

export async function retireLegacyVolume({
 root='/data',env=process.env,inspect=lstat,list=readdir,remove=rm,filesystem=statfs,
 log=console.log
}={}){
 if(!retirementConfirmed(env))return {status:'disabled'};
 const target=join(root,'horizon-agents-postgres');
 if(resolve(target)!==resolve(root,'horizon-agents-postgres'))throw Error('Unsafe legacy path');
 let st;
 try{st=await inspect(target);}
 catch(error){if(error.code==='ENOENT')return {status:'already_retired'};throw error;}
 if(!st.isDirectory()||st.isSymbolicLink())throw Error('Legacy path is not a real directory');
 // Refuse to delete a target that does not look like the exact legacy database.
 const contents=await list(target);
 for(const required of ['PG_VERSION','base','global','pg_wal']){
   if(!contents.includes(required))throw Error('Legacy database signature mismatch: '+required);
 }
 const before=await filesystem(root);
 const beforeFree=Number(before.bavail)*Number(before.bsize);
 await remove(target,{recursive:true,force:false,maxRetries:3,retryDelay:100});
 // Fail verification if any PG root remains, even after the removal call succeeded.
 try{await inspect(target);throw Error('Legacy database directory still present');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const after=await filesystem(root);
 const afterFree=Number(after.bavail)*Number(after.bsize);
 const result={status:'retired',removed:'horizon-agents-postgres',
   freeBeforeMB:Math.round(beforeFree/1048576*100)/100,
   freeAfterMB:Math.round(afterFree/1048576*100)/100,
   reclaimedMB:Math.round((afterFree-beforeFree)/1048576*100)/100,
   archivalSha256:LEGACY_ARCHIVE_SHA256};
 log('[horizon-legacy-retired] '+JSON.stringify(result));
 return result;
}
