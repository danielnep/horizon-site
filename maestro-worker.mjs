import {MAESTRO} from './maestro/identity.mjs';
import {ENGINEERING_CONTEXT} from './maestro/engineering.mjs';
import {SUPERVISOR_INSTRUCTION,buildPrompt} from './maestro/prompt.mjs';
import {loadCheckpoint} from './maestro/checkpoint.mjs';
import {normalizeDecision,toMayHandoff} from './maestro/protocol.mjs';
export const IDENTITY=MAESTRO,PLUGINS=MAESTRO.plugins;
export async function consultGemini({apiKey=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL||'gemini-3.8-flash',
 fetcher=fetch,now=new Date(),checkpoint=null,checkpointStatus='unavailable',previous=null,staleCount=0}={}){
 if(!apiKey)throw Error('GEMINI_API_KEY ausente');
 if(!/^[a-zA-Z0-9_.-]{3,80}$/.test(model))throw Error('Modelo invalido');
 const userContext=buildPrompt({checkpoint,checkpointStatus,previous,staleCount,now});
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
 checkpoint=null,checkpointStatus='unavailable',previous=null,staleCount=0}={}){
 if(!deepSeekKey)throw Error('DEEPSEEK_API_KEY ausente no supervisor');
 if(!/^[a-zA-Z0-9_.-]{3,80}$/.test(deepSeekModel))throw Error('Modelo DeepSeek invalido');
 const userContext=buildPrompt({checkpoint,checkpointStatus,previous,staleCount,now});
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
export async function consultWithFallback(options={}){
 try{return await consultGemini(options);}
 catch(geminiError){
  // Do not retry a non-idempotent action: both providers generate only a decision.
  // Never pass API errors or secrets as model instructions.
  try{
   const decision=await consultDeepSeek(options);
   const log=options.log||console.log;
   log('[maestro-provider-fallback] '+JSON.stringify({from:'gemini',to:'deepseek',
     reason:safeFailure(geminiError),result:'success'}));
   return decision;
  }catch(deepSeekError){
   const log=options.log||console.log;
   log('[maestro-provider-fallback] '+JSON.stringify({from:'gemini',to:'deepseek',
     reason:safeFailure(geminiError),fallback:safeFailure(deepSeekError),result:'failed'}));
   throw Error('Supervisor indisponivel: Gemini '+safeFailure(geminiError)+'; DeepSeek '+safeFailure(deepSeekError));
  }
 }
}
export const review=consultWithFallback;
export async function runSupervisorCycle({fetcher=fetch,gemini=consultWithFallback,clock=()=>new Date(),
 checkpointUrl=process.env.MAESTRO_CHECKPOINT_URL,previous=null,staleCount=0,log=console.log}={}){
 const now=clock();
 log('[maestro-engineering-context] '+JSON.stringify(ENGINEERING_CONTEXT));
 const state=await loadCheckpoint({fetcher,...(checkpointUrl?{url:checkpointUrl}:{}),now});
 const currentId=state.checkpoint?.last_execution?.id||null;
 const oldId=previous?.checkpointExecutionId||null;
 const unacknowledged=oldId!==null&&oldId===currentId?staleCount+1:0;
 const decision=await gemini({fetcher,checkpoint:state.checkpoint,checkpointStatus:state.status,
 previous,staleCount:unacknowledged,now,log});
 const handoff=toMayHandoff(decision);
 log('[maestro-supervisor] '+JSON.stringify(decision));
 log('[maestro-handoff] '+JSON.stringify(handoff));
 return {decision,handoff,checkpointStatus:state.status,staleCount:unacknowledged};
}
export function startScheduledReviewer({env=process.env,run=runSupervisorCycle,clock=()=>new Date(),
 log=console.log,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout}={}){
 if(env.MAESTRO_ENABLE_AUTO!=='1'){log('[maestro] supervisor desabilitado');return ()=>{};}
 let stopped=false,active=false,timer=null,previous=null,unchanged=0;
 const tick=async()=>{
 if(stopped||active)return;
 active=true;let minutes=10;
 try{
  const r=await run({clock,log,previous,staleCount:unchanged});
  if(stopped)return;
  previous=r.decision;unchanged=r.staleCount;minutes=r.decision.nextCallMinutes;
  log('[maestro-scheduler] '+JSON.stringify({nextAt:r.decision.nextCallAt,minutes,checkpointStatus:r.checkpointStatus}));
 }catch(e){if(!stopped)log('[maestro-error] '+String(e?.message||e).slice(0,240)+'; repeticao em 10 minutos');}
 finally{active=false;if(!stopped){timer=schedule(tick,minutes*60000);timer?.unref?.();}}
 };
 timer=schedule(tick,12000);timer?.unref?.();
 return ()=>{stopped=true;if(timer!==null)cancel(timer)};
}