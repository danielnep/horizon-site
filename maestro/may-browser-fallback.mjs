import {createHash} from 'node:crypto';
import {normalizeDecision} from './protocol.mjs';

// Read the authenticated, existing conversation. Native KERNEL mouse/keyboard sends.
const CHAT='https://chatgpt.com/c/6ad68dab-1178-83e9-a409-7c7014281b68';
const BASE='https://api.onkernel.com/browsers/may-chatgpt-72h';
export function consultationTicket({priorityQueue,checkpoint}={}){
 const priority=priorityQueue?.highest?.id||'no-priority';
 const execution=checkpoint?.last_execution?.id||'no-execution';
 return createHash('sha256').update('horizon-may-supervisor-v1|'+priority+'|'+execution).digest('hex').slice(0,20);
}
export function publicConsultation({ticket,priorityQueue,checkpointStatus}){
 const t=priorityQueue?.highest;
 const p=t&&/^danielnep\/[A-Za-z0-9._-]+$/.test(t.repo)&&/^[A-Za-z0-9._-]{1,160}$/.test(t.id)
   ? t.priority+' '+t.id+' em '+t.repo : 'não verificada';
 const st=['fresh','stale','unavailable','awaiting-first-checkpoint'].includes(checkpointStatus)?checkpointStatus:'unavailable';
 return ['[HORIZON CONSULTA V2]','AGENTE: may-maestro','TICKET: '+ticket,
  'TIPO: providers_unavailable',
  'PERGUNTA: Gemini e DeepSeek falharam no supervisor Railway. Prioridade pública: '+p+'. Checkpoint: '+st+'.',
  'Responda somente JSON com protocol_version:2, next_call_minutes (60..10080), priority, focus, next_may_task,',
  'acceptance_criteria, why_this_time, context_summary, checkpoint_needed e confidence.',
  'Não alegue testes, código publicado, recebimento ou acesso a dados privados. Mantenha P0 prioritária.'].join('\n');
}
async function inspectUi(q,context){
 const tabs=context.pages().filter(p=>p.url().split('?')[0]===q.url);
 if(!tabs.length)return {status:'conversation_unavailable'};
 let sent=false,busy=false,first=null,draftMatches=0;
 for(const p of tabs){
   const composer=p.getByRole('textbox',{name:'Ask ChatGPT'});
   if(await composer.count()!==1)continue;
   const root=p.getByRole('region',{name:'Conversation'});
   if(await root.count()!==1)continue;
   const reply=await root.evaluate((node,marker)=>{
     const h=[...node.querySelectorAll('h4')].filter(e=>['You said:','ChatGPT said:'].includes((e.textContent||'').trim()));
     for(let i=h.length-1;i>=0;i--){
       if((h[i].textContent||'').trim()!=='You said:'||!(h[i].parentElement?.innerText||'').includes(marker))continue;
       if(h[i+1]&&(h[i+1].textContent||'').trim()==='ChatGPT said:'){
         const t=(h[i+1].parentElement?.innerText||'').replace(/^ChatGPT said:\s*/,'').trim();
         return t?{status:'answered',answer:t.slice(0,3000)}:{status:'sent'};
       }
       return {status:'sent'};
     }
     return null;
   },'TICKET: '+q.ticket);
   if(reply?.status==='answered')return reply;
   if(reply?.status==='sent')sent=true;
   const draft=(await composer.innerText()).trim();
   if(draft)busy=true;
   if(draft===q.prompt.trim())draftMatches++;
   if(!first&&!draft)first={p,composer};
 }
 if(sent)return {status:'sent'};
 if(q.stage==='read')return {status:'not_found'};
 if(q.stage==='draft')return {status:draftMatches===1?'draft_ready':'draft_mismatch'};
 if(busy)return {status:'composer_busy'};
 if(!first)return {status:'composer_unavailable'};
 await first.p.bringToFront();
 const rect=await first.composer.boundingBox();
 if(!rect||rect.width<10||rect.height<10)return {status:'composer_unavailable'};
 return {status:'ready',box:{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}};
}
function inspectionCode(packet){
 return 'return await ('+inspectUi.toString()+')('+JSON.stringify(packet)+',context);';
}
async function defaultPost(url,body,key){
 const response=await fetch(url,{method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'Accept':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(52000)});
 if(!response.ok)throw Error('kernel_http_'+response.status);
 if(url.endsWith('/playwright/execute')){
  const parsed=await response.json();
  return parsed?.success===true?parsed.result:null;
 }
 return null;
}
export async function requestMayBrowserDecision({env=process.env,priorityQueue,checkpoint,
  checkpointStatus,now=new Date(),store,post=defaultPost,log=()=>{}}={}){
 if(!env.KERNEL_API_KEY)return {status:'not_configured'};
 if(!store?.read||!store?.write)return {status:'durable_store_required'};
 const ticket=consultationTicket({priorityQueue,checkpoint});
 const prompt=publicConsultation({ticket,priorityQueue,checkpointStatus});
 const call=(path,body)=>post(BASE+path,body,env.KERNEL_API_KEY);
 const inspect=stage=>call('/playwright/execute',{code:inspectionCode({url:CHAT,ticket,prompt,stage}),
   executor:'horizon-central',timeout_sec:50});
 const stored=(await store.read()).mayBrowserFallback;
 if(stored&&stored.ticket!==ticket&&stored.status!=='answered')
   return {status:'older_ticket_unreconciled'};
 let state;
 try{state=await inspect('read');}
 catch{return {status:'browser_unavailable'};}
 if(state?.status==='answered'){
   let raw=String(state.answer||'').trim();
   if(raw.charCodeAt(0)===96){
     const lines=raw.split('\n');
     if(lines.length>=3&&lines.at(-1).trim()==String.fromCharCode(96).repeat(3))
       raw=lines.slice(1,-1).join('\n').trim();
   }
   let decision;
   try{decision=normalizeDecision(JSON.parse(raw),{now,checkpoint,checkpointStatus,provider:'may'});}
   catch{return {status:'reply_invalid'};}
   await store.write({...await store.read(),mayBrowserFallback:{ticket,status:'answered',at:now.toISOString()}});
   log('[maestro-may-browser] '+JSON.stringify({status:'answered',ticket}));
   return {status:'answered',decision};
 }
 if(state?.status==='sent')return {status:'waiting_for_reply'};
 if(stored?.ticket===ticket)return {status:'delivery_unconfirmed_no_resend'};
 try{state=await inspect('prepare');}
 catch{return {status:'browser_unavailable'};}
 if(state?.status!=='ready')return {status:state?.status==='composer_busy'?'draft_preserved':'browser_unavailable'};
 const point=state.box;
 if(!point||!Number.isInteger(point.x)||!Number.isInteger(point.y))
   return {status:'composer_unavailable'};
 // Persist BEFORE touching the GUI. Never resend an uncertain submission.
 await store.write({...await store.read(),mayBrowserFallback:{ticket,status:'delivery_uncertain',at:now.toISOString()}});
 try{
  await call('/computer/click_mouse',{x:point.x,y:point.y});
  await call('/computer/type_text',{text:prompt});
  const draft=await inspect('draft');
  if(draft?.status!=='draft_ready')return {status:'draft_preserved'};
  await call('/computer/press_key',{keys:['Return']});
  const seen=await inspect('read');
  return {status:seen?.status==='sent'||seen?.status==='answered'?'sent_waiting_for_reply':'delivery_unconfirmed'};
 }catch{return {status:'delivery_unconfirmed'};}
}
