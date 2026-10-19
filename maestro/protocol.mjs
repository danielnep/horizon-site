import {MAESTRO} from './identity.mjs';
import {ENGINEERING_CONTEXT} from './engineering.mjs';
export function normalizeDecision(raw,{now=new Date(),checkpoint=null,checkpointStatus='unavailable',provider='gemini'}={}){
 if(raw?.protocol_version!==2)throw Error('protocol_version deve ser 2');
 const n=raw.next_call_minutes;
 if(!Number.isInteger(n)||n<60||n>10080)throw Error('next_call_minutes deve estar entre 60 e 10080');
 if(!['critical','high','normal','low'].includes(raw.priority))throw Error('priority invalida');
 const fields={};
 for(const key of ['focus','next_may_task','acceptance_criteria','why_this_time','context_summary']){
  if(typeof raw[key]!=='string'||!raw[key].trim())throw Error('Campo obrigatorio '+key);
  fields[key]=raw[key].trim().slice(0,500);
 }
 if(!Array.isArray(raw.checkpoint_needed))throw Error('checkpoint_needed precisa ser array');
 return {protocolVersion:2,source:provider==='deepseek'?'deepseek-supervisor':'gemini-supervisor',decisionAt:now.toISOString(),
 nextCallAt:new Date(now.getTime()+n*60000).toISOString(),nextCallMinutes:n,
 priority:raw.priority,focus:fields.focus,nextMayTask:fields.next_may_task,
 acceptanceCriteria:fields.acceptance_criteria,whyThisTime:fields.why_this_time,
 contextSummary:fields.context_summary,
 checkpointNeeded:raw.checkpoint_needed.filter(s=>typeof s==='string').slice(0,5).map(s=>s.slice(0,160)),
 confidence:raw.confidence==='grounded'?'grounded':'limited-context',
 checkpointStatus,checkpointExecutionId:checkpoint?.last_execution?.id||'none',
 automationId:MAESTRO.existing_task_id,
 reminder:'Railway agenda consultas do supervisor com fallback Gemini e DeepSeek. So May no ChatGPT pode reajustar a tarefa do ChatGPT.'};
}
export function toMayHandoff(d){
 return {kind:'may-maestro-handoff-v2',target:'May no ChatGPT',priority:d.priority,
 engineeringMethods:ENGINEERING_CONTEXT,
 focus:d.focus,dueAtUtc:d.nextCallAt,taskId:d.automationId,
 instruction:d.nextMayTask,acceptance:d.acceptanceCriteria,knownContext:d.contextSummary,
 checkpointStatus:d.checkpointStatus,checkpointExecutionId:d.checkpointExecutionId,
 handoffId:d.handoffId??null,checkpointReadability:d.checkpointReadability??'unavailable',
 checkpointAgeMinutes:d.checkpointAgeMinutes??null,executionStatus:d.executionStatus??'unverified',
 pendingHandoffs:d.pendingHandoffs??0,overdueHandoffs:d.overdueHandoffs??0,
 beforeWork:'Ler maestro/metodos-engenharia-may.md na revisao indicada pelo sha256. Aplicar investigacao causal, alteracao na origem e verificacao proporcional ao escopo.',
 afterWork:'Registrar evidencias e o handoff_id exato no campo last_execution.handoff_id do maestro/checkpoint.json na branch agents/checkpoints; sem recibo verificado esta ordem permanece pendente. Reagendar mesma automacao somente se ferramenta disponivel.'};
}