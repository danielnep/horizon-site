import {MAESTRO} from './maestro/identity.mjs';
import {ENGINEERING_CONTEXT} from './maestro/engineering.mjs';
import {SUPERVISOR_INSTRUCTION,buildPrompt} from './maestro/prompt.mjs';
import {loadCheckpoint} from './maestro/checkpoint.mjs';
import {randomUUID} from 'node:crypto';
import {createFileHandoffStore,emptyHandoffState,reconcileHandoffs,observeCheckpoint,registerHandoff,summarizeHandoffs} from './maestro/handoff-store.mjs';
import {normalizeDecision,toMayHandoff} from './maestro/protocol.mjs';
export const IDENTITY=MAESTRO,PLUGINS=MAESTRO.plugins;
export async function consultGemini({apiKey=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL||'gemini-3.8-flash',
 fetcher=fetch,now=new Date(),checkpoint=null,checkpointStatus='unavailable',checkpointAudit=null,previous=null,staleCount=0}={}){
 if(!apiKey)throw Error('GEMINI_API_KEY ausente');
 if(!/^[a-zA-Z0-9_.-]{3,80}$/.test(model))throw Error('Modelo invalido');
 const userContext=buildPrompt({checkpoint,checkpointStatus,checkpointAudit,previous,staleCount,now});
 const payload={systemInstruction:{parts:[{text:SUPERVISOR_INSTRUCTION}]},
 contents:[{role:'user',parts:[{text:userContext}]}],
 generationConfig:{temperature:0.15,responseMimeType:'application/json',maxOutputTokens:2300}};
 const response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
 method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
 body:JSON.stringify(payload),signal:AbortSignal.timeout(50000)});
 if(!response.ok){let msg='';try{const err=(await response.json()).error;msg=String(err?.status||'')+' '+String(err?.message||'').replace(/AIza[\\w-]{20,}/g,'[redacted]').slice(0,180);}catch{}
 throw Error('Gemini HTTP '+response.status+' '+msg);}
 const r=await response.json();
 const output=(r.candidates?.[0]?.content?.parts??[]).map(x=>x.text||'').join('');
 if(!output)throw Error('Gemini devolveu resposta vazia');
 let raw;try{raw=JSON.parse(output);}catch{throw Error('Gemini devolveu JSON invalido');}
 return normalizeDecision(raw,{now,checkpoint,checkpointStatus});
}
export async function consultDeepSeek({deepSeekKey=process.env.DEEPSEEK_API_KEY,
 deepSeekModel=process.env.DEEPSEEK_MODEL||'deepseek-chat',fetcher=fetch,now=new Date(),
 checkpoint=null,checkpointStatus='unavailable',checkpointAudit=null,previous=null,staleCount=0}={}){
 if(!deepSeekKey)throw Error('DEEPSEEK_API_KEY ausente no supervisor');
 if(!/^[a-zA-Z0-9_.-]{3,80}$/.test(deepSeekModel))throw Error('Modelo DeepSeek invalido');
 const userContext=buildPrompt({checkpoint,checkpointStatus,checkpointAudit,previous,staleCount,now});
 const payload={model:deepSeekModel,
   messages:[{role:'system',content:SUPERVISOR_INSTRUCTION},{role:'user',content:userContext}],
   response_format:{type:'json_object'},temperature:0.15,max_tokens:2300};
 const response=await fetcher('https://api.deepseek.com/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+deepSeekKey},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(50000)});
 if(!response.ok)throw Error('DeepSeek HTTP '+response.status);
 const result=await response.json();
 const output=result?.choices?.[0]?.message?.content;
 if(typeof output!=='string'||!output.trim())throw Error('DeepSeek devolveu resposta vazia');
 let raw;
 try{raw=JSON.parse(output);}catch{throw Error('DeepSeek devolveu JSON invalido');}
 return normalizeDecision(raw,{now,checkpoint,checkpointStatus,provider:'deepseek'});
}
function safeFailure(error){
 const message=String(error?.message||error);
 const match=message.match(/(?:Gemini|DeepSeek) HTTP \d{3}/);
 return match?match[0]:message.includes('ausente')?'credential_missing':error?.name==='TimeoutError'?'timeout':'provider_error';
}
// Process-local circuit: a payment error will not be fixed by retrying every 10 min.
// Gemini is still consulted, and recovery never depends on the DeepSeek balance.
let deepSeekPaymentHoldUntil=0;
export function paymentCircuitStatus(now=Date.now()){
 return {blocked:now<deepSeekPaymentHoldUntil,retryAfterMs:Math.max(0,deepSeekPaymentHoldUntil-now)};
}
export async function consultWithFallback(options={}){
 try{return await consultGemini(options);}
 catch(geminiError){
  // Both providers produce a decision only. Do not retry tools or leak secrets.
  const nowMs=options.now instanceof Date?options.now.getTime():Date.now();
  const log=options.log||console.log;
  if(nowMs<deepSeekPaymentHoldUntil){
   log('[maestro-provider-fallback] '+JSON.stringify({from:'gemini',to:'deepseek',
     reason:safeFailure(geminiError),fallback:'DeepSeek HTTP 402',
     result:'skipped_payment_circuit',retryAfterSeconds:Math.ceil((deepSeekPaymentHoldUntil-nowMs)/1000)}));
   throw Error('Supervisor indisponivel: Gemini '+safeFailure(geminiError)+'; DeepSeek payment_circuit_open');
  }
  try{
   const decision=await consultDeepSeek(options);
   deepSeekPaymentHoldUntil=0;
   log('[maestro-provider-fallback] '+JSON.stringify({from:'gemini',to:'deepseek',
     reason:safeFailure(geminiError),result:'success'}));
   return decision;
  }catch(deepSeekError){
   const failure=safeFailure(deepSeekError);
   if(failure==='DeepSeek HTTP 402')deepSeekPaymentHoldUntil=nowMs+60*60*1000;
   log('[maestro-provider-fallback] '+JSON.stringify({from:'gemini',to:'deepseek',
     reason:safeFailure(geminiError),fallback:failure,result:'failed',
     paymentCircuitSeconds:failure==='DeepSeek HTTP 402'?3600:0}));
   throw Error('Supervisor indisponivel: Gemini '+safeFailure(geminiError)+'; DeepSeek '+failure);
  }
 }
}
export const review=consultWithFallback;
export async function runSupervisorCycle({fetcher=fetch,gemini=consultWithFallback,clock=()=>new Date(),
 checkpointUrl=process.env.MAESTRO_CHECKPOINT_URL,previous=null,staleCount=0,log=console.log,handoffStore=null}={}){
 const now=clock();
 log('[maestro-engineering-context] '+JSON.stringify(ENGINEERING_CONTEXT));
 const state=await loadCheckpoint({fetcher,...(checkpointUrl?{url:checkpointUrl}:{}),now});
 // Durable handoff receipts are separate from the public May-owned checkpoint.
 const stored=handoffStore?await handoffStore.read():emptyHandoffState();
 const reconciled=reconcileHandoffs(stored,state.checkpoint,now);
 const audit=summarizeHandoffs(reconciled.state,state);
 if(!handoffStore)audit.executionStatus='unverified';
 // Always write the checkpoint observation before contacting AI. A 429/402/503
 // cannot suppress evidence of an unchanged, unreadable or overdue checkpoint.
 const durableState=handoffStore?observeCheckpoint(reconciled.state,audit,now):reconciled.state;
 if(handoffStore){
  await handoffStore.write(durableState);
  log('[maestro-checkpoint-audit] '+JSON.stringify({
   observedAt:now.toISOString(),...audit,persistenceStatus:'persisted'
  }));
 }
 for(const change of reconciled.changes){
  if(change.status==='overdue')log('[maestro-handoff-alert] '+JSON.stringify({handoffId:change.id,status:'overdue',reason:'no_matching_verified_checkpoint'}));
 }
 const currentId=state.checkpoint?.last_execution?.id||null;
 const oldId=previous?.checkpointExecutionId||null;
 const unacknowledged=handoffStore?audit.pendingHandoffs+audit.overdueHandoffs:
   oldId!==null&&oldId===currentId?staleCount+1:0;
 const rawDecision=await gemini({fetcher,checkpoint:state.checkpoint,checkpointStatus:state.status,
 checkpointAudit:audit,previous,staleCount:unacknowledged,now,log});
 const decision={...rawDecision,...audit,handoffId:randomUUID(),
  persistenceStatus:handoffStore?'persisted':'unavailable'};
 // Persist BEFORE publishing the handoff. On storage failure, the cycle fails
 // visibly and the scheduler retries instead of advertising an untracked job.
 if(handoffStore)await handoffStore.write(registerHandoff(durableState,decision,{id:decision.handoffId}));
 const handoff=toMayHandoff(decision);
 log('[maestro-supervisor] '+JSON.stringify(decision));
 log('[maestro-handoff] '+JSON.stringify(handoff));
 return {decision,handoff,checkpointStatus:state.status,staleCount:unacknowledged};
}
export function startScheduledReviewer({env=process.env,run=runSupervisorCycle,clock=()=>new Date(),
 log=console.log,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout,handoffStore=createFileHandoffStore()}={}){
 if(env.MAESTRO_ENABLE_AUTO!=='1'){log('[maestro] supervisor desabilitado');return ()=>{};}
 let stopped=false,active=false,timer=null,previous=null,unchanged=0;
 const tick=async()=>{
 if(stopped||active)return;
 active=true;let minutes=10;
 try{
  const r=await run({clock,log,previous,staleCount:unchanged,handoffStore});
  if(stopped)return;
  previous=r.decision;unchanged=r.staleCount;minutes=r.decision.nextCallMinutes;
  log('[maestro-scheduler] '+JSON.stringify({nextAt:r.decision.nextCallAt,minutes,checkpointStatus:r.checkpointStatus}));
 }catch(e){if(!stopped)log('[maestro-error] '+String(e?.message||e).slice(0,240)+'; repeticao em 10 minutos');}
 finally{active=false;if(!stopped){timer=schedule(tick,minutes*60000);timer?.unref?.();}}
 };
 timer=schedule(tick,12000);timer?.unref?.();
 return ()=>{stopped=true;if(timer!==null)cancel(timer)};
}