import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {
 generateRegistrationOptions,verifyRegistrationResponse,
 generateAuthenticationOptions,verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const ceremonies=new Map();
const storePath=()=>process.env.HORIZON_OWNER_PASSKEY_STORE||'';
const bootstrap=()=>process.env.HORIZON_OWNER_BOOTSTRAP_KEY||'';
const rpID=()=>process.env.HORIZON_WEBAUTHN_RP_ID||'';
const now=()=>Date.now();
const safeSame=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
 const one=Buffer.from(a),two=Buffer.from(b);
 return one.length===two.length&&timingSafeEqual(one,two);
};
async function record(){
 const path=storePath();
 if(!path)throw Error('passkey_storage_not_configured');
 try{
  const data=JSON.parse(await readFile(path,'utf8'));
  if(!Array.isArray(data.credentials))throw Error('invalid_credential_store');
  return data;
 }catch(err){
  if(err?.code==='ENOENT')return {credentials:[]};
  throw err;
 }
}
async function persist(value){
 const path=storePath();
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const tmp=path+'.tmp.'+randomBytes(8).toString('hex');
 await writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});
 await rename(tmp,path);
}
function siteOrigin(origin){
 const expected='https://'+rpID();
 if(!rpID()||origin!==expected)throw Error('webauthn_origin_not_allowed');
 return expected;
}
function remember(kind,challenge,origin){
 if(ceremonies.size>90)ceremonies.clear();
 const id=randomBytes(18).toString('base64url');
 ceremonies.set(id,{kind,challenge,origin,expires:now()+180000});
 return id;
}
function take(id,kind,origin){
 const value=ceremonies.get(id);
 ceremonies.delete(id);
 if(!value||value.kind!==kind||value.origin!==origin||value.expires<now())throw Error('webauthn_ceremony_expired');
 return value.challenge;
}
export const passkeyEnabled=()=>Boolean(storePath()&&rpID()&&bootstrap());
export async function ownerPasskeyStatus(){
 if(!passkeyEnabled())return {enabled:false,enrolled:false};
 const d=await record();
 return {enabled:true,enrolled:d.credentials.length>0};
}
export async function beginEnrollment({origin,key,authorized}){
 if(!passkeyEnabled())throw Error('passkey_not_configured');
 siteOrigin(origin);
 const data=await record();
 if(!authorized&&(data.credentials.length||!safeSame(key,bootstrap())))throw Error('owner_enrollment_denied');
 const options=await generateRegistrationOptions({
  rpName:'Horizon Central',rpID:rpID(),userName:'Proprietário Horizon',
  userID:new Uint8Array(Buffer.from('horizon-owner-001')),
  attestationType:'none',
  authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
  excludeCredentials:data.credentials.map(x=>({id:x.id,transports:x.transports||[]})),
  supportedAlgorithmIDs:[-7,-257],
 });
 return {options,ceremony:remember('registration',options.challenge,origin)};
}
export async function completeEnrollment({origin,key,authorized,ceremony,response}){
 siteOrigin(origin);
 const challenge=take(ceremony,'registration',origin);
 const data=await record();
 if(!authorized&&(data.credentials.length||!safeSame(key,bootstrap())))throw Error('owner_enrollment_denied');
 const verified=await verifyRegistrationResponse({
  response,expectedChallenge:challenge,expectedOrigin:origin,expectedRPID:rpID(),requireUserVerification:true,
  supportedAlgorithmIDs:[-7,-257],
 });
 if(!verified.verified||!verified.registrationInfo?.credential)throw Error('passkey_registration_unverified');
 const cred=verified.registrationInfo.credential;
 if(data.credentials.some(x=>x.id===cred.id))throw Error('passkey_already_exists');
 data.credentials.push({
  id:cred.id,publicKey:Buffer.from(cred.publicKey).toString('base64url'),
  counter:cred.counter||0,transports:response.response?.transports||[],
  registeredAt:new Date().toISOString(),
 });
 await persist(data);
 return {ok:true};
}
export async function beginAuthentication({origin}){
 siteOrigin(origin);
 const data=await record();
 if(!data.credentials.length)throw Error('owner_passkey_not_registered');
 const options=await generateAuthenticationOptions({
  rpID:rpID(),userVerification:'required',
  allowCredentials:data.credentials.map(x=>({id:x.id,transports:x.transports||[]})),
 });
 return {options,ceremony:remember('authentication',options.challenge,origin)};
}
export async function completeAuthentication({origin,ceremony,response}){
 siteOrigin(origin);
 const challenge=take(ceremony,'authentication',origin);
 const data=await record();
 const cred=data.credentials.find(x=>x.id===response?.id);
 if(!cred)throw Error('unknown_owner_credential');
 const verified=await verifyAuthenticationResponse({
  response,expectedChallenge:challenge,expectedOrigin:origin,expectedRPID:rpID(),
  credential:{id:cred.id,publicKey:new Uint8Array(Buffer.from(cred.publicKey,'base64url')),
   counter:cred.counter,transports:cred.transports},requireUserVerification:true,
 });
 if(!verified.verified)throw Error('owner_assertion_unverified');
 cred.counter=verified.authenticationInfo.newCounter;
 await persist(data);
 return {ok:true};
}
