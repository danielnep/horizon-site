import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const VERSION=1;
const MAX_HANDOFFS=256;
const ID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
export const emptyHandoffState=()=>({version:VERSION,handoffs:[],lastObservation:null});

function assertState(state){
  if(!state||state.version!==VERSION||!Array.isArray(state.handoffs)||state.handoffs.length>MAX_HANDOFFS)throw Error('Estado de handoffs invalido');
  const o=state.lastObservation;
  if(o!==undefined&&o!==null){
    if(typeof o!=='object'||Array.isArray(o)||!Number.isFinite(Date.parse(o.checkedAt))||
       !['readable','unavailable'].includes(o.checkpointReadability)||
       !['fresh','stale','unavailable','awaiting-first-checkpoint'].includes(o.checkpointRecencyStatus)||
       !['overdue','pending','acknowledged','unverified'].includes(o.executionStatus)||
       !(o.checkpointAgeMinutes===null||(Number.isSafeInteger(o.checkpointAgeMinutes)&&o.checkpointAgeMinutes>=0))||
       !Number.isSafeInteger(o.pendingHandoffs)||o.pendingHandoffs<0||
       !Number.isSafeInteger(o.overdueHandoffs)||o.overdueHandoffs<0){
      throw Error('Observacao de checkpoint invalida');
    }
  }
  // Operational SQLite telemetry is not a handoff receipt. Persist it separately.
  if(o?.operational!==undefined){
    const op=o.operational;
    if(!op||!['verified','unavailable','disabled'].includes(op.status))
      throw Error('Observacao operacional invalida');
    if(op.status==='verified'&&(
      !/^agent-state\/railway-[a-z0-9-]{2,36}$/.test(op.branch||'')||
      !/^[a-f0-9]{40}$/.test(op.snapshotSha||'')||
      !Number.isSafeInteger(op.taskCount)||op.taskCount<0||
      !['recent','stale','unknown','invalid_future'].includes(op.eventRecency)||
      !(op.lastEventAt===null||Number.isFinite(Date.parse(op.lastEventAt)))||
      !(op.lastSuccessEventAt===null||Number.isFinite(Date.parse(op.lastSuccessEventAt)))||
      !Number.isSafeInteger(op.eventAgeMinutes??0)||
      !op.taskCounts||['queued','running','succeeded','failed','blocked'].some(k=>
        !Number.isSafeInteger(op.taskCounts[k])||op.taskCounts[k]<0)||
      ['queued','running','succeeded','failed','blocked'].reduce((n,k)=>n+op.taskCounts[k],0)!==op.taskCount
    ))throw Error('Dados operacionais invalidos');
  }
  const seen=new Set();
  for(const h of state.handoffs){
    if(!h||typeof h.id!=='string'||!ID.test(h.id)||seen.has(h.id)||!['pending','overdue','acknowledged'].includes(h.status))throw Error('Handoff invalido');
    if(!Number.isFinite(Date.parse(h.issuedAt))||!Number.isFinite(Date.parse(h.dueAtUtc)))throw Error('Data de handoff invalida');
    seen.add(h.id);
  }
  return state;
}

export function createFileHandoffStore({file=process.env.MAESTRO_HANDOFF_STATE_PATH||'/data/maestro-supervisor-handoffs.json'}={}){
  return {
    file,
    async read(){
      try{return assertState(JSON.parse(await readFile(file,'utf8')));}
      catch(error){if(error?.code==='ENOENT')return emptyHandoffState();throw error;}
    },
    async write(state){
      assertState(state);
      const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
      await mkdir(dirname(file),{recursive:true});
      try{
        await writeFile(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});
        await rename(tmp,file);
      }catch(error){await unlink(tmp).catch(()=>{});throw error;}
    }
  };
}

export function reconcileHandoffs(state,checkpoint,now=new Date()){
  assertState(state);
  const confirmedId=checkpoint?.last_execution?.handoff_id;
  const confirmation=checkpoint?.last_execution?.verification;
  const checkpointTime=Date.parse(checkpoint?.updated_at||'');
  const changes=[];
  const handoffs=state.handoffs.map(h=>{
    if(h.status==='acknowledged')return h;
    // A timestamp, a new execution ID or an LLM claim is NOT proof of acknowledgment.
    if(h.id===confirmedId && typeof confirmation==='string' && confirmation.trim() &&
       checkpointTime>Date.parse(h.issuedAt)){
      changes.push({id:h.id,status:'acknowledged'});
      return {...h,status:'acknowledged',acknowledgedAt:new Date(checkpointTime).toISOString()};
    }
    if(now.getTime()>=Date.parse(h.dueAtUtc) && h.status!=='overdue'){
      changes.push({id:h.id,status:'overdue'});
      return {...h,status:'overdue'};
    }
    return h;
  });
  return {state:{...state,handoffs},changes};
}

export function summarizeHandoffs(state,checkpointState){
  assertState(state);
  const pending=state.handoffs.filter(h=>h.status==='pending');
  const overdue=state.handoffs.filter(h=>h.status==='overdue');
  const acknowledged=state.handoffs.filter(h=>h.status==='acknowledged');
  const readability=checkpointState.readable?'readable':'unavailable';
  const executionStatus=overdue.length?'overdue':pending.length?'pending':acknowledged.length?'acknowledged':'unverified';
  return {
    checkpointReadability:readability,
    checkpointUpdatedAt:checkpointState.checkpoint?.updated_at??null,
    checkpointAgeMinutes:checkpointState.ageMinutes??null,
    checkpointRecencyStatus:checkpointState.status,
    executionStatus,
    pendingHandoffs:pending.length,
    overdueHandoffs:overdue.length,
    lastAcknowledgedHandoffId:acknowledged.at(-1)?.id??null
  };
}

export function observeCheckpoint(state,audit,now=new Date()){
  assertState(state);
  const observation={
    checkedAt:now.toISOString(),
    checkpointReadability:audit.checkpointReadability,
    checkpointUpdatedAt:audit.checkpointUpdatedAt,
    checkpointAgeMinutes:audit.checkpointAgeMinutes,
    checkpointRecencyStatus:audit.checkpointRecencyStatus,
    executionStatus:audit.executionStatus,
    pendingHandoffs:audit.pendingHandoffs,
    overdueHandoffs:audit.overdueHandoffs,
    operational:audit.operational
  };
  return assertState({...state,lastObservation:observation});
}

export function registerHandoff(state,decision,{id=randomUUID()}={}){
  assertState(state);
  if(state.handoffs.length>=MAX_HANDOFFS)throw Error('Limite de handoffs atingido; preservar historico e investigar');
  if(!ID.test(id)||state.handoffs.some(h=>h.id===id))throw Error('ID de handoff duplicado ou invalido');
  const handoff={
    id,issuedAt:decision.decisionAt,dueAtUtc:decision.nextCallAt,
    checkpointExecutionId:decision.checkpointExecutionId,status:'pending'
  };
  if(!Number.isFinite(Date.parse(handoff.issuedAt))||!Number.isFinite(Date.parse(handoff.dueAtUtc)))throw Error('Data de handoff invalida');
  return {...state,handoffs:[...state.handoffs,handoff]};
}
