import { TOOL_IDS, TOOL_BY_ID, FLOW_ORDER } from './tools.js';
export const STATUS = { solicitado: 'Solicitado', andamento: 'Em andamento', pendente: 'Pendente', concluido: 'Concluído', aberto: 'Aberto', encaminhado: 'Encaminhado', resolvido: 'Resolvido', marcado: 'Agendado', solicitacao: 'Solicitação', aprovacao: 'Em aprovação' };
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
export const clean = (value, limit = 200) => String(value ?? '').trim().slice(0, limit);
export function localDay(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function shiftDay(day, amount) { const date = new Date(day + 'T12:00:00'); date.setDate(date.getDate()+amount); return localDay(date); }
export function formatDay(day) { if (!day) return 'Sem prazo'; const date = new Date(day+'T12:00:00'); return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(date); }
const clone = value => JSON.parse(JSON.stringify(value));
const makeId = () => globalThis.crypto?.randomUUID?.() || `hp-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
export function createDemoState(now = new Date(), tools = TOOL_IDS) {
  const day = localDay(now), at = now.toISOString();
  const services = [
    {id:'srv-101',title:'Revisão do ar-condicionado',client:'Unidade Centro',owner:'Marina',status:'solicitado',due:shiftDay(day,2),at},
    {id:'srv-102',title:'Conferência do estoque',client:'Unidade Norte',owner:'Lucas',status:'andamento',due:day,at},
    {id:'srv-103',title:'Troca de iluminação',client:'Unidade Centro',owner:'Rafael',status:'pendente',due:shiftDay(day,-1),at},
    {id:'srv-104',title:'Manutenção do portão',client:'Unidade Sul',owner:'Marina',status:'concluido',due:day,at}
  ];
  const state = {
    version:1, selected:[], services,
    inspection:{id:'chk-101',title:'Conferência do estoque',serviceId:'srv-102',owner:'Lucas',status:'andamento',notes:'',items:[
      {id:'area',text:'Área organizada e acessos livres',done:false},
      {id:'itens',text:'Itens e quantidades conferidos',done:false},
      {id:'equipamentos',text:'Equipamentos verificados',done:false},
      {id:'divergencias',text:'Divergências registradas',done:false}
    ]},
    inspections:[],
    appointments:[
      {id:'ag-101',title:'Retorno sobre orçamento',company:'Empresa Exemplo',owner:'Marina',date:day,time:'14:30',kind:'Retorno',status:'marcado',at},
      {id:'ag-102',title:'Visita à Unidade Norte',company:'Unidade Norte',owner:'Lucas',date:shiftDay(day,1),time:'09:00',kind:'Visita',status:'marcado',at}
    ],
    approvals:[
      {id:'ap-101',title:'Compra de materiais',owner:'Rafael',stage:'solicitacao',at},
      {id:'ap-102',title:'Orçamento de manutenção',owner:'Marina',stage:'aprovacao',at}
    ],
    incidents:[
      {id:'oc-101',title:'Lâmpada apagada na recepção',place:'Unidade Centro',owner:'Rafael',priority:'normal',status:'aberto',at},
      {id:'oc-102',title:'Vazamento na área de serviço',place:'Unidade Norte',owner:'Lucas',priority:'alta',status:'encaminhado',at}
    ],
    proofs:[{id:'cp-101',serviceId:'srv-104',title:'Manutenção do portão',owner:'Marina',notes:'Ajuste realizado e funcionamento conferido.',photo:'',at}],
    rows:services.map(service => ({id:service.id,type:'Serviço',title:service.title,owner:service.owner,quantity:1,status:service.status,at})),
    events:[{id:'ev-101',entityId:'srv-104',text:'Manutenção do portão concluída',at}],
    lastSimulation:null
  };
  // Indicadores também podem demonstrar uma base de exemplo independente.
  const enabled = new Set(tools);
  if (!(enabled.size === 1 && enabled.has('indicadores'))) {
    if (!enabled.has('servicos')) { state.services = []; state.inspection.serviceId = ''; }
    if (!enabled.has('agendamentos')) state.appointments = [];
    if (!enabled.has('etapas')) state.approvals = [];
    if (!enabled.has('ocorrencias')) state.incidents = [];
    if (!enabled.has('comprovantes')) state.proofs = [];
    if (!enabled.has('planilhas')) state.rows = [];
    else if (!enabled.has('servicos')) state.rows = [
      { id:'reg-example', type:'Registro', title:'Materiais recebidos', owner:'Marina', quantity:12, status:'concluido', at }
    ];
    if (!enabled.has('servicos')) state.events = [];
  }
  return state;
}
export class DemoStore {
  constructor({storage = null,key = 'horizon-preview:demo:v1',now = () => new Date(),tools = TOOL_IDS} = {}) {
    this.storage=storage; this.key=key; this.now=now; this.listeners=new Set(); this.persistent=!!storage;
    this.tools=[...new Set(tools)].filter(id=>TOOL_IDS.includes(id));
    this.state=createDemoState(this.now(),this.tools);
    try {
      const raw=storage?.getItem(key); if(raw) {
        const saved=JSON.parse(raw);
        if (saved.version===1 && ['selected','services','inspections','appointments','approvals','incidents','proofs','rows','events'].every(name => Array.isArray(saved[name])) && Array.isArray(saved.inspection?.items)) {
          saved.selected=saved.selected.filter(id => TOOL_IDS.includes(id)); this.state=saved;
        }
      }
    } catch { this.state=createDemoState(this.now(),this.tools); }
  }
  enabled(id) { return this.tools.includes(id); }
  requireTool(id) { if (!this.enabled(id)) throw new Error('Esta ferramenta não faz parte da demonstração escolhida.'); }
  syncRecord(type, item, status = item.status || item.stage) {
    if (!this.enabled('planilhas')) return;
    this.upsertRow({id:item.id,type,title:item.title,owner:item.owner,quantity:1,status,at:item.at});
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  commit(notify = true) {
    try { this.storage?.setItem(this.key,JSON.stringify(this.state)); this.persistent=!!this.storage; } catch {this.persistent=false;}
    if(notify) this.listeners.forEach(listener => listener(this.state));
  }
  log(text, entityId = '') { this.state.events.unshift({id:makeId(),text,entityId,at:this.now().toISOString()}); this.state.events=this.state.events.slice(0,150); }
  upsertRow(record) { const index=this.state.rows.findIndex(row=>row.id===record.id); if(index<0)this.state.rows.unshift(record); else this.state.rows[index]={...this.state.rows[index],...record}; }
  toggleTool(id) { if(!TOOL_IDS.includes(id))return; const chosen=this.state.selected; this.state.selected=chosen.includes(id)?chosen.filter(item=>item!==id):[...chosen,id];this.commit(); }
  selectTools(ids) { this.state.selected=[...new Set(ids)].filter(id=>TOOL_IDS.includes(id)); this.commit(); }
  addRecord(input) {
    this.requireTool('planilhas');
    const title=clean(input.title), owner=clean(input.owner,80), quantity=Number(input.quantity);
    if(!title||!owner||!Number.isInteger(quantity)||quantity<1||quantity>999999) throw new Error('Preencha o registro, o responsável e uma quantidade válida.');
    const row={id:makeId(),type:'Registro',title,owner,quantity,status:'concluido',at:this.now().toISOString()};
    this.upsertRow(row); this.log(`Registro incluído na planilha: ${title}`,row.id);this.commit();return row;
  }
  removeRecord(id) { const row=this.state.rows.find(row=>row.id===id); if(row?.type!=='Registro')return; this.state.rows=this.state.rows.filter(row=>row.id!==id);this.log(`Registro removido: ${row.title}`,id);this.commit(); }
  addService(input) {
    this.requireTool('servicos');
    const title=clean(input.title),owner=clean(input.owner,80),client=clean(input.client,80);
    if(!title||!owner||!client)throw new Error('Preencha serviço, unidade e responsável.');
    const service={id:makeId(),title,owner,client,due:clean(input.due,10),status:'solicitado',at:this.now().toISOString()};
    this.state.services.unshift(service);this.syncService(service);this.log(`Serviço solicitado: ${title}`,service.id);this.commit();return service;
  }
  syncService(service) {this.syncRecord('Serviço',service);}
  setServiceStatus(id,status) {
    if(!['solicitado','andamento','pendente','concluido'].includes(status))return;
    const service=this.state.services.find(item=>item.id===id);if(!service||service.status===status)return;
    service.status=status;service.at=this.now().toISOString();this.syncService(service);this.log(`${service.title}: ${STATUS[status]}`,id);this.commit();
  }
  toggleInspectionItem(id) {const inspection=this.state.inspection;if(inspection.status==='concluido')return;const item=inspection.items.find(item=>item.id===id);if(item){item.done=!item.done;this.commit();}}
  updateInspectionNotes(notes) {this.state.inspection.notes=clean(notes,1200);this.commit(false);}
  completeInspection() {
    this.requireTool('checklists');
    const inspection=this.state.inspection;
    if(inspection.status==='concluido')return false;
    if(!inspection.items.every(item=>item.done))throw new Error('Confira todos os itens antes de concluir.');
    inspection.status='concluido';inspection.at=this.now().toISOString();this.state.inspections.unshift(clone(inspection));
    const service=this.state.services.find(service=>service.id===inspection.serviceId);
    if(service){service.status='concluido';service.at=inspection.at;this.syncService(service);}
    this.syncRecord('Checklist',inspection,'concluido');
    this.log('Checklist concluído: '+inspection.title,inspection.id);this.commit();return true;
  }
  newInspection() {
    this.requireTool('checklists');
    const previous=this.state.inspection;
    const service={id:makeId(),title:'Nova conferência do estoque',client:'Unidade Norte',owner:previous.owner,due:localDay(this.now()),status:'andamento',at:this.now().toISOString()};
    if (this.enabled('servicos')) { this.state.services.unshift(service);this.syncService(service); }
    this.state.inspection={...clone(previous),id:makeId(),title:service.title,serviceId:this.enabled('servicos')?service.id:'',status:'andamento',notes:'',at:undefined,items:previous.items.map(item=>({...item,done:false}))};this.commit();
  }
  addAppointment(input) {
    this.requireTool('agendamentos');
    const title=clean(input.title),owner=clean(input.owner,80),company=clean(input.company,80),date=clean(input.date,10),time=clean(input.time,5);
    if(!title||!owner||!company||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T12:00:00').getTime())||date<localDay(this.now())||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Preencha o compromisso e escolha uma data a partir de hoje.');
    const appointment={id:makeId(),title,owner,company,date,time,kind:['Atendimento','Retorno','Visita'].includes(input.kind)?input.kind:'Retorno',status:'marcado',at:this.now().toISOString()};
    this.state.appointments.push(appointment);this.syncRecord('Agendamento',appointment);this.log(`Compromisso agendado: ${title}`,appointment.id);this.commit();return appointment;
  }
  appointmentAction(id,action) {const item=this.state.appointments.find(item=>item.id===id);if(!item||item.status==='concluido')return;if(action==='concluir')item.status='concluido';else if(action==='adiar')item.date=shiftDay(item.date,1);else return;item.at=this.now().toISOString();this.syncRecord('Agendamento',item);this.log(`${item.title}: ${action==='adiar'?'adiado em um dia':'concluído'}`,id);this.commit();}
  addApproval(input) {this.requireTool('etapas');const title=clean(input.title),owner=clean(input.owner,80);if(!title||!owner)throw new Error('Informe a solicitação e o responsável.');const item={id:makeId(),title,owner,stage:'solicitacao',at:this.now().toISOString()};this.state.approvals.unshift(item);this.syncRecord('Aprovação',item);this.log(`Processo criado: ${title}`,item.id);this.commit();return item;}
  approvalAction(id,action) {const item=this.state.approvals.find(item=>item.id===id);if(!item)return;const next=action==='avancar'?(item.stage==='solicitacao'?'aprovacao':item.stage==='aprovacao'?'concluido':null):action==='ajuste'&&item.stage==='aprovacao'?'solicitacao':null;if(!next)return;item.stage=next;item.at=this.now().toISOString();this.syncRecord('Aprovação',item);this.log(`${item.title}: ${action==='ajuste'?'ajuste solicitado':STATUS[next]}`,id);this.commit();}
  addIncident(input) {this.requireTool('ocorrencias');const title=clean(input.title),place=clean(input.place,80),owner=clean(input.owner,80);if(!title||!place||!owner)throw new Error('Preencha problema, local e responsável.');const item={id:makeId(),title,place,owner,priority:input.priority==='alta'?'alta':'normal',status:'aberto',at:this.now().toISOString()};this.state.incidents.unshift(item);this.syncRecord('Ocorrência',item);this.log(`Ocorrência registrada: ${title}`,item.id);this.commit();return item;}
  incidentAction(id) {const item=this.state.incidents.find(item=>item.id===id);if(!item||item.status==='resolvido')return;item.status=item.status==='aberto'?'encaminhado':'resolvido';item.at=this.now().toISOString();this.syncRecord('Ocorrência',item);this.log(`${item.title}: ${STATUS[item.status]} · ${item.owner}`,id);this.commit();}
  addProof(input) {
    this.requireTool('comprovantes');
    const service=this.state.services.find(service=>service.id===input.serviceId),owner=clean(input.owner,80),notes=clean(input.notes,1500);
    const title=service?.title||(!this.enabled('servicos')?clean(input.title):'');
    if(!title||!owner||!notes)throw new Error('Informe a atividade, o responsável e o que foi realizado.');
    const photo=String(input.photo||'');if(photo&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo))throw new Error('Use uma foto JPEG, PNG ou WebP.');if(photo.length>1200000)throw new Error('A foto ficou grande demais. Tente outra imagem.');
    const proof={id:makeId(),serviceId:service?.id||'',title,owner,notes,photo,at:this.now().toISOString()};this.state.proofs.unshift(proof);this.syncRecord('Comprovante',proof,'concluido');this.log(`Execução registrada: ${title}`,proof.id);this.commit();return proof;
  }
  simulate() {
    const selected=FLOW_ORDER.filter(id=>this.state.selected.includes(id));if(!selected.length)throw new Error('Escolha pelo menos uma ferramenta.');
    const at=this.now().toISOString(),day=localDay(this.now()),title='Conferência da unidade',owner='Lucas',entityId=makeId();
    const results=[];
    for(const id of selected) {
      let text='';
      if(id==='ocorrencias'){this.state.incidents.unshift({id:makeId(),title:'Solicitação de conferência',place:'Unidade Exemplo',owner,priority:'normal',status:'resolvido',at});text='Solicitação registrada e resolvida';}
      if(id==='agendamentos'){this.state.appointments.unshift({id:makeId(),title:'Retorno da conferência',company:'Unidade Exemplo',owner,date:day,time:'10:00',kind:'Retorno',status:'concluido',at});text='Retorno registrado como concluído';}
      if(id==='etapas'){this.state.approvals.unshift({id:makeId(),title:'Aprovação da conferência',owner,stage:'concluido',at});text='Processo percorrido e aprovado';}
      if(id==='checklists'){this.state.inspections.unshift({id:makeId(),title,owner,notes:'Conferência demonstrativa realizada.',serviceId:selected.includes('servicos')?entityId:'',status:'concluido',at,items:this.state.inspection.items.map(item=>({...item,done:true}))});text='Checklist conferido e concluído';}
      if(id==='servicos'){const service={id:entityId,title,client:'Unidade Exemplo',owner,status:'concluido',due:day,at};this.state.services.unshift(service);this.syncService(service);text='Serviço atualizado para concluído';}
      if(id==='comprovantes'){this.state.proofs.unshift({id:makeId(),serviceId:selected.includes('servicos')?entityId:'srv-104',title,owner,notes:'Execução confirmada no fluxo demonstrativo.',photo:'',at});text='Comprovante de execução criado';}
      if(id==='planilhas'){this.upsertRow({id:entityId,type:'Fluxo integrado',title,owner,quantity:1,status:'concluido',at});text='Conclusão registrada na planilha';}
      if(id==='indicadores'){text='Indicadores recalculados com os registros atuais';}
      results.push({id,text});
    }
    this.state.lastSimulation={id:entityId,at,results};this.log(`Fluxo integrado executado com ${selected.length} ferramenta${selected.length===1?'':'s'}`,entityId);this.commit();return this.state.lastSimulation;
  }
  reset() {const selected=[...this.state.selected];this.state=createDemoState(this.now(),this.tools);this.state.selected=selected;this.commit();}
}
export function toolStats(state,onlyToday = false,now = new Date()) {
  const match=item=>!onlyToday||(item.at&&localDay(new Date(item.at))===localDay(now));
  const services=state.services.filter(match),appointments=state.appointments.filter(item=>!onlyToday||item.date===localDay(now));
  return {services:services.length,completed:services.filter(item=>item.status==='concluido').length,openIncidents:state.incidents.filter(match).filter(item=>item.status!=='resolvido').length,inspections:state.inspections.filter(match).length,appointments:appointments.filter(item=>item.status==='marcado').length,rows:state.rows.filter(match).length,proofs:state.proofs.filter(match).length,statuses:Object.fromEntries(['solicitado','andamento','pendente','concluido'].map(status=>[status,services.filter(item=>item.status===status).length]))};
}
export function csv(rows) {return '\ufeff'+rows.map(row=>row.map(value=>{let cell=String(value??'');if(/^[=+@\-\t\r]/.test(cell))cell="'"+cell;return '"'+cell.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
export function validatePhone(value) {const digits=String(value??'').replace(/\D/g,'');return /^\d{10,15}$/.test(digits)?digits:null;}
export function makeWhatsAppMessage({name,company,role,need,selected,referral=''}) {
  return [
    'Olá, Horizon! Quero uma solução para minha empresa.','',
    `Nome: ${clean(name,100)}`,`Empresa: ${clean(company,100)}`,`Cargo ou função: ${clean(role,100)}`,'',
    'Ferramentas escolhidas:',...(selected.filter(id=>TOOL_IDS.includes(id)).map(id=>`• ${TOOL_BY_ID[id].name}`).length?selected.filter(id=>TOOL_IDS.includes(id)).map(id=>`• ${TOOL_BY_ID[id].name}`):['• Ferramenta personalizada']),
    '',`Minha necessidade: ${clean(need,1800)}`,...(referral?['',`Indicação: ${clean(referral,80)}`]:[])
  ].join('\n');
}
export function buildShareUrl(base,{selected=[],referral='',route='inicio',embed=false}={}) {const url=new URL(base);url.search='';url.hash=route;if(selected.length)url.searchParams.set('f',selected.filter(id=>TOOL_IDS.includes(id)).join(','));if(referral)url.searchParams.set('parceiro',clean(referral,80));if(embed)url.searchParams.set('embed','1');return url.toString();}
