// May Maestro: Gemini schedules/delegates. May inspects, builds and fixes.
export const PLUGINS=[
{id:'plugins_6ad2d8cb1ff481918155636b10ce1c78',name:'May Maestro'},
{id:'plugins_6ad2c7ad78f081918faf5ebde103166a',name:'Corregedoria May'},
{id:'plugins_6ad2b7424c9c8191aa71b4d54485b17c',name:'May Persona'},
{id:'plugins_6ad2b3bdc9d08191abea836e62329919',name:'Horizon Skills'},
{id:'plugins_6ad292dd3a108191bd868a5d14609a0a',name:'Horizon Evolution Agent'},
{id:'plugins_6ad28e9f576c81919c2bcf1297e38986',name:'Horizon Project Studio'},
{id:'plugins_6ad28bfb661081919a20fd45806f3c54',name:'Horizon UI Guardian'}];
export const IDENTITY=Object.freeze({
name:'May Maestro | Orquestrador Horizon',
purpose:'Supervisionar continuidade de entregas concretas da Horizon e chamar May no ChatGPT quando necessario',
gemini:'Supervisor de agenda e prioridades: decide a proxima chamada, delega a tarefa a May; NAO inspeciona projetos nem edita codigo ou plugins',
may:'May (ChatGPT) e a executora: le manuais, inspeciona repositorios, codifica, testa, corrige e registra fatos verificaveis',
chatgpt:'A mesma automacao existente deve ser REPROGRAMADA pela May apos cada chamada; Railway nao possui API de automacoes da conta',
automationId:'6ad32bbba5488191aee18ef5fafd37b7',
timeZone:'America/Sao_Paulo',
projects:['app-hondas-maxvel','romaneio-digital','michelle-preview','horizon-preview','horizon-site'],
tools:'Plugin Creator, GitHub, Railway e outros conectores estao na May, nao diretamente no Gemini',
noGuessing:'Sem logs/resultados fornecidos, declare contexto limitado e mande May inspecionar o estado real'});
export function normalizeDecision(raw,now=new Date()){
 const minutes=Number(raw?.next_call_minutes);
 if(!Number.isInteger(minutes)||minutes<60||minutes>10080)throw new Error('next_call_minutes deve ser inteiro entre 60 e 10080');
 const task=String(raw?.next_may_task||'').trim(),reason=String(raw?.why_this_time||'').trim(),criteria=String(raw?.acceptance_criteria||'').trim();
 if(!task||!reason||!criteria)throw new Error('Plano de supervisao incompleto');
 return {at:now.toISOString(),nextCallAt:new Date(now.getTime()+minutes*60000).toISOString(),nextCallMinutes:minutes,
 nextMayTask:task.slice(0,400),whyThisTime:reason.slice(0,400),acceptanceCriteria:criteria.slice(0,400),
 confidence:raw?.confidence==='grounded'?'grounded':'limited-context',source:'Gemini supervisor'};
}
export async function consultGemini({apiKey=process.env.GEMINI_API_KEY,fetcher=fetch,model=process.env.GEMINI_MODEL||'gemini-3.8-flash',checkpoint=null,now=new Date()}={}){
 if(!apiKey)throw new Error('GEMINI_API_KEY ausente');
 if(!/^[\w.-]{3,70}$/.test(model))throw new Error('Modelo invalido');
 const prompt=['Voce e Gemini, SUPERVISOR DE CHAMADAS do May Maestro, nao desenvolvedor. Leia seu papel com atencao.',
 'IDENTIDADE E MISSAO: '+JSON.stringify(IDENTITY),
 'PLUGINS DISPONIVEIS SOMENTE A MAY: '+JSON.stringify(PLUGINS),
 'AGORA: '+now.toISOString(), 'ULTIMO CHECKPOINT DE May (se disponivel): '+JSON.stringify(checkpoint??{status:'sem evidencias atualizadas'}),
 'Decida QUANDO May deve ser chamada novamente e QUAL ACAO concretamente verificavel ela deve executar.',
 'SOMENTE May audita, testa e modifica projetos e plugins. Gemini apenas supervisiona horarios e delega.',
 'Sem evidencias nao invente progresso. Intervalo entre 60 e 10080 minutos; proximidade conforme urgencia e dependencias.',
 'A May vai reajustar a MESMA automacao ChatGPT, sem criar outras. Gemini nao tem acesso direto ao agendador.',
 'Retorne exatamente JSON: {"next_call_minutes":120,"next_may_task":"...","why_this_time":"...","acceptance_criteria":"...","confidence":"limited-context|grounded"}.'].join('\n');
 const response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
 method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
 signal:AbortSignal.timeout(45000),
 body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:'application/json',maxOutputTokens:1400}})});
 if(!response.ok){let detail='';try{const err=(await response.json()).error;detail=String(err?.status||'')+' '+String(err?.message||'').replace(/AIza[\w-]{20,}/g,'[redacted]').slice(0,130);}catch{}
 throw new Error('Gemini HTTP '+response.status+' '+detail);}
 const data=await response.json(),output=(data.candidates?.[0]?.content?.parts??[]).map(p=>p.text||'').join('');
 return normalizeDecision(JSON.parse(output),now);
}
export const review=consultGemini;
export function startScheduledReviewer({env=process.env,run=consultGemini,log=console.log,clock=()=>new Date(),
 schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout}={}){
 if(env.MAESTRO_ENABLE_AUTO!=='1'){log('[maestro] supervisao desabilitada');return ()=>{};}
 let stopped=false,active=false,timer=null,previous=null;
 const tick=async()=>{
  if(stopped||active)return;active=true;let delay=60*60000;
  try{const decision=await run({checkpoint:previous,now:clock()});if(stopped)return;
   previous={decision,receivedAt:clock().toISOString()};
   delay=decision.nextCallMinutes*60000;
   log('[maestro-supervisor] '+JSON.stringify(decision));
  }catch(e){if(!stopped)log('[maestro-error] '+String(e?.message||e)+'; reconsulta em 60 minutos');}
  finally{active=false;if(!stopped){timer=schedule(tick,delay);timer?.unref?.();}}
 };
 timer=schedule(tick,12000);timer?.unref?.();
 return ()=>{stopped=true;if(timer!==null)cancel(timer);};
}
