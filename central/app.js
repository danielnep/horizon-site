import {splitTaskPlan,taskPlanStatus} from './task-steps.mjs';
import {studioMarkup,mountStudio,notifyStudioChanged,stopStudio} from './studio.mjs';
const $=id=>document.getElementById(id);
const PAGES_MODE=location.hostname.endsWith('.github.io');

async function pagesOverview(){
 return {at:new Date().toISOString(),source:'VPS Hostinger',
  connection:{state:'disconnected',message:'Conexão direta com a VPS ainda não estabelecida.'},
  agents:[],tasks:[],events:[],activity:[],
  worker:{status:'sem ligação com a VPS',lastCycle:null},
  issues:['Dados reais dos agentes só poderão ser consultados na VPS.'],
  available:{vps:false,queue:false,results:false,attendance:false},
  usage:{available:false,input:null,output:null,total:null,calls:0,byProvider:{},byAgent:{},byModel:{}}
 };
}

const AGENT_NAMES={
'may-maestro':'May Maestro','horizon-project-studio':'Estúdio Horizon','software-architect':'Arquitetura',
'frontend-engineer':'Frontend','backend-engineer':'Backend','mobile-app-builder':'Aplicativos Mobile',
'ui-ux-designer':'Design UI/UX','horizon-ui-guardian':'UI Guardian','database-engineer':'Banco de Dados',
'integration-engineer':'Integrações','qa-engineer':'QA / Testes','security-engineer':'Segurança',
'devops-engineer':'DevOps','horizon-evolution-agent':'Aprimoramento','horizon-skills':'Habilidades',
'corregedoria-may':'Corregedoria','may-persona':'May Persona'};
const LABELS={estudio:'Estúdio Horizon',inicio:'Central de Agentes',tarefas:'Tarefas',agentes:'17 agentes',historico:'Histórico',consumo:'Consumo de tokens',sistema:'Sistema'};
let repoList=[],repoLoadError=null,selectedRepository='danielnep/romaneio-digital',selectedPriority='P2',selectedAgentId='may-maestro';
let snapshot=null,online=false,stream=null,refreshing=null,term='',filter='todos',draft='',working=false,selectedAgent=null;
let noticeTimeout;
let archivedTasks=[];
const agentConfigs=new Map();
const agentDrafts=new Map();
const taskDrafts=new Map();
const editPanels=new Set();
const taskSelections=new Set();
const openTasks=new Set();
const ANALYSIS_KEY='horizon-analysis-v1';
let analysisState={request:{busy:false,text:'',error:false},diagnose:{busy:false,text:'',error:false}};
try{
 const saved=JSON.parse(sessionStorage.getItem(ANALYSIS_KEY)||'null');
 if(saved&&typeof saved==='object')for(const key of ['request','diagnose']){
  if(typeof saved[key]?.text==='string')analysisState[key]={busy:false,text:saved[key].text.slice(0,2200),error:Boolean(saved[key].error)};
 }
}catch{}
function persistAnalysis(){
 try{sessionStorage.setItem(ANALYSIS_KEY,JSON.stringify(analysisState));}catch{}
}
function repaintAnalysis(){
 for(const [key,resultId,buttonId,label] of [['request','ai-result','ai-action','Analisar com IA'],['diagnose','diagnosis-result','diagnose-ai','Investigar com IA']]){
  const state=analysisState[key],result=$(resultId),button=$(buttonId);
  if(result){result.hidden=!state.busy&&!state.text;result.textContent=state.busy?'Analisando com IA. Os dados continuam sendo atualizados sem fechar este resultado.':state.text;result.setAttribute('role',state.error?'alert':'status');}
  if(button){button.disabled=state.busy;button.textContent=state.busy?'Analisando…':label;}
 }
}
async function runAnalysis(key,path,body){
 const state=analysisState[key];if(state.busy)return;
 state.busy=true;state.text='';state.error=false;repaintAnalysis();
 try{
  const out=await api(path,{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(23000)});
  state.text=(out.response||'A análise terminou sem resposta do provedor.')+
   (key==='request'&&out.usage?.input!==null&&out.usage?.input!==undefined?'\n\nTokens: '+out.usage.input+' entrada, '+(out.usage.output??'não informado')+' saída.':'');
 }catch(e){state.text='A análise não foi concluída: '+(e.name==='TimeoutError'?'tempo limite de 23 segundos excedido':e.message)+'. Você pode tentar novamente.';state.error=true;}
 finally{state.busy=false;persistAnalysis();repaintAnalysis();}
}
let adminAuthorized=false;
let pendingCommand=null;
let actionTimer=null;
const helpHistory=[];
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function time(x){if(!x)return 'Não informado';const d=new Date(x);return Number.isNaN(d.getTime())?'Não informado':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);}
function label(id){return AGENT_NAMES[id]||id||'Não atribuído';}
const STATUS_PT={
 pending:'Pendente',queued:'Na fila',running:'Trabalhando',active:'Ativo',idle:'Disponível',paused:'Pausado',
 cancelled:'Cancelado',canceled:'Cancelado',blocked:'Bloqueado',failed:'Falhou',error:'Erro',
 succeeded:'Concluído',completed:'Concluído',reported:'Resultado registrado',accepted:'Recebida',
 waiting:'Aguardando',deferred:'Aguardando nova tentativa',stopped:'Parado',working:'Trabalhando',
 ready:'Disponível',unclassified:'Ainda não identificado',not_found:'Não encontrada'};
function emPortugues(value){
 if(!value)return 'Não informado';
 const text=String(value);
 if(STATUS_PT[text.toLowerCase()])return STATUS_PT[text.toLowerCase()];
 return text.split(/([ -])/).map(v=>STATUS_PT[v.toLowerCase()]||v.replaceAll('_',' ')).join('');
}
function acaoEmPortugues(action,path){
 const places=path?' em '+path:'';
 return ({
 started:'Iniciou a tarefa',thinking:'Está analisando o próximo passo',read_file:'Está lendo um arquivo'+places,
 list_files:'Está identificando os arquivos do projeto',write_file:'Está modificando o código'+places,
 run_check:'Está executando testes',remember:'Está registrando uma decisão',
 finish:'Está finalizando a execução',delegate:'Está distribuindo trabalhos para especialistas',
 search_web:'Está pesquisando informações',fetch_public:'Está consultando uma referência',
 inspect_image:'Está verificando uma imagem'})[action]||'Atividade recente identificada';
}
const WAIT_LABELS=Object.freeze({
 scheduled_retry:'Nova tentativa programada',
 waiting_for_dependencies:'Aguardando uma etapa anterior',
 ready_for_worker:'Pronta para execução pelo worker',
 being_executed:'Etapa em execução',
 lease_expired:'Execução anterior perdeu a reserva; recuperação necessária',
 terminal_failed:'Etapa falhou e exige recuperação',
 terminal_blocked:'Etapa bloqueada por falha anterior',
 all_stages_reported:'Etapas encerradas; verificar testes e publicação'
});
const RETRY_LABELS=Object.freeze({
 groq_capacity_wait:'Aguardando capacidade de chamadas do Groq',
 provider_retry:'A IA respondeu com erro temporário; nova tentativa agendada',
 repair_cycle:'O especialista encontrou falhas repetidas e precisa refazer o diagnóstico'
});
function waitDescription(reason,retryReason){
 const base=WAIT_LABELS[reason]||'Aguardando justificativa registrada pelo executor';
 return reason==='scheduled_retry'&&retryReason?base+': '+(RETRY_LABELS[retryReason]||retryReason.replaceAll('_',' ')):base;
}
function taskWaitingSummary(t){
 const s=t.supervision;
 if(!s||!s.firstPendingTask||!s.reason)return '';
 let info=waitDescription(s.reason,s.retryReason);
 if(s.firstPendingAgent)info+=' · '+label(s.firstPendingAgent);
 if(s.nextRetryAt)info+=' · próxima tentativa '+time(s.nextRetryAt);
 if(s.blockedBy?.length)info+=' · depende de '+s.blockedBy.join(', ');
 return info;
}
function chip(s){
 const v=String(s||'não verificado');
 const cls=/bloque|falha|rejeit|erro/i.test(v)?'bad':/execu|conclu|ativo|iniciado/i.test(v)?'good':/aguard|fila/i.test(v)?'warn':'';
 return '<span class="chip '+cls+'">'+escapeHTML(emPortugues(v))+'</span>';
}
function note(txt,isError=false){
 const el=$('notice');clearTimeout(noticeTimeout);el.textContent=txt;el.hidden=false;el.style.borderColor=isError?'#ff867c':'#536273';noticeTimeout=setTimeout(()=>el.hidden=true,7500);
}
async function api(path,options={}){
 if(PAGES_MODE){if(path==='session')return {authenticated:true,configured:false};if(path==='overview')return pagesOverview();throw Error('Comando indisponível no modo leitura');}
 const response=await fetch('/central/api/'+path,{credentials:'same-origin',cache:'no-store',headers:options.body?{'content-type':'application/json'}:{},...options});
 let data;try{data=await response.json();}catch{data={error:'resposta_invalida'};}
 if(response.status===401){if(options.method==='POST')showLogin(true);throw Error('A consulta é livre. Para enviar comandos, é necessária autorização administrativa.');}
 if(!response.ok)throw Error(String(data.error||'Falha de comunicação').replaceAll('_',' '));
 return data;
}
function showLogin(show){$('gate').hidden=!show;if(show)$('password')?.focus();}
function active(){const x=(location.hash||'#inicio').replace(/^#/,'');return LABELS[x]?x:'inicio';}
function updateMenu(){
 const page=active();$('page-label').textContent=LABELS[page];
 document.querySelectorAll('[data-page]').forEach(x=>{x.classList.toggle('active',x.dataset.page===page);if(x.dataset.page===page)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
}
function heading(title,subtitle=''){return '<div class="page-head"><div><p class="eyebrow">HORIZON / OPERAÇÕES</p><h1>'+escapeHTML(title)+'</h1>'+(subtitle?'<p class="subtitle">'+escapeHTML(subtitle)+'</p>':'')+'</div><span class="time-label">'+(snapshot?'Atualizado '+time(snapshot.at):'Aguardando dados')+'</span></div>';}
function counts(){
 const t=snapshot?.tasks||[],q=t.filter(x=>x.inQueue);
 return {total:t.length,active:q.filter(x=>x.status==='em execução').length,
 waiting:q.filter(x=>['aguardando','na fila','aguardando validação'].includes(x.status)).length,
 blocked:q.filter(x=>x.status==='bloqueada').length,
 queue:q.length,offQueue:t.filter(x=>!x.inQueue&&!x.published).length};
}
function summary(){if(!snapshot?.available?.vps)return '<div class="central-vps-offline" role="status"><strong>VPS desconectada</strong><p>Não há confirmação de tarefas, agentes ou consumo. Nenhum dado antigo será mostrado como atual.</p></div>';const c=counts();return '<div class="summary" aria-label="Situação geral"><span class="working"><b>'+c.active+'</b> trabalhando</span><span><b>'+c.queue+'</b> na fila</span><span><b>'+c.offQueue+'</b> pendências fora da fila</span><span class="problem"><b>'+c.blocked+'</b> bloqueadas na fila</span><span><b>17</b> agentes</span></div>';}
function taskRow(t){
 const latest=t.lastActivity||null,stamp=latest&&Date.parse(latest.at),fresh=Number.isFinite(stamp)&&Date.now()-stamp<120000;
 const pendingDiagnosis=taskWaitingSummary(t);
 const active=fresh&&t.inQueue&&!/pausada|cancelada|concluída/.test(t.status);
 const progress=t.progress;
 const validProgress=progress&&Number.isInteger(progress.done)&&Number.isInteger(progress.total)&&progress.total>0&&progress.done<=progress.total;
 const value=validProgress?Math.round(100*progress.done/progress.total):null;
 const track=validProgress?'<div class="task-progress-display"><div style="width:'+value+'%"></div></div><span class="smallprint">'+
  progress.done+' de '+progress.total+' etapas com resultado registrado</span>':
  active?'<div class="task-progress-display indefinite"><div></div></div><span class="smallprint">Trabalhando. Sem previsão confiável de conclusão.</span>':'';
 const activity=latest?acaoEmPortugues(latest.action,latest.path):t.inQueue?'Aguardando o próximo registro do executor':'Não há atividade recente registrada.';
 const subtitle=latest?'Especialista: '+label(latest.agent)+' • Último sinal: '+time(latest.at):'Especialista: '+label(t.agent);
 const live='<div class="live-operation"><div class="live-operation-title">'+(active?'<i class="pulse" aria-hidden="true"></i>':'')+
  escapeHTML(active?'Atividade atual':'Última atividade conhecida')+'</div><p class="live-operation-message">'+escapeHTML(activity)+'</p>'+
  '<span class="live-operation-time">'+escapeHTML(subtitle)+'</span>'+track+'</div>';
 const writtenPlan=splitTaskPlan(t.description||t.title);
 const recordedStages=Array.isArray(t.stages)?t.stages:[];
 // Some task contracts are a single paragraph. Present actual worker stages
 // instead of hiding the checklist just because the prose had no line breaks.
 const planItems=writtenPlan.length>1?writtenPlan:recordedStages.length>1?
  recordedStages.map((stage,i)=>String(stage.summary||'Etapa '+(i+1)+' · '+label(stage.agent)).slice(0,600)):writtenPlan;
 const statuses=taskPlanStatus(planItems,recordedStages);
 const checklist=statuses.length>1?'<section class="task-plan"><h3>Etapas previstas</h3><ol>'+
  statuses.map((item,i)=>'<li class="'+(item.verified?'task-step-done':'task-step-pending')+'"><span class="task-step-marker">'+
  (item.verified?'✓':i+1)+'</span><div><span>'+escapeHTML(item.text.length>155?item.text.slice(0,152)+'…':item.text)+'</span><small>'+
  (item.verified?'Concluída com registro':item.grounded?emPortugues(item.state):'Aguardando confirmação individual')+
  (item.agent?' · '+escapeHTML(label(item.agent)):'')+'</small>'+
  (item.text.length>155?'<details class="task-step-full"><summary>Ver descrição completa</summary><p>'+escapeHTML(item.text)+'</p></details>':'')+
  '</div></li>').join('')+'</ol></section>':'';
 const steps=Array.isArray(t.stages)&&t.stages.length?
  '<div class="task-stages">'+t.stages.map(stage=>{
   const technical=stage.state==='queued'||stage.state==='running'?
    '<p class="stage-reason">'+escapeHTML(waitDescription(stage.waitReason,stage.retryReason))+
    (stage.nextRetryAt?' · Retomar: '+escapeHTML(time(stage.nextRetryAt)):'')+
    (stage.blockedBy?.length?' · Depende de: '+escapeHTML(stage.blockedBy.join(', ')):'')+'</p>':'';
   const attempts=Number.isInteger(stage.attempts)?
    '<small class="smallprint">Tentativas: '+stage.attempts+
    (Number.isInteger(stage.maxAttempts)?' de '+stage.maxAttempts:'')+
    (Number.isInteger(stage.checkpointStep)?' · Ações registradas: '+stage.checkpointStep:'')+'</small>':'';
   return '<div class="stage-line"><span class="stage-icon">'+
   (stage.state==='succeeded'||stage.state==='completed'?'✓':'○')+
   '</span><div><b>'+escapeHTML(label(stage.agent))+'</b> '+chip(stage.state)+
   (stage.summary?'<p>'+escapeHTML(stage.summary)+'</p>':'')+
   technical+attempts+(stage.blocker?'<p class="error">Problema: '+escapeHTML(stage.blocker)+'</p>':'')+
   '</div></div>';
  }).join('')+'</div>':
  '<p class="smallprint">Não há detalhes de etapas anteriores registrados.</p>';
 const taskId=escapeHTML(t.id);
 const controls=PAGES_MODE?'':t.status==='arquivada'?
 '<div class="task-controls"><button class="secondary" data-task-action="restore" data-task-id="'+taskId+'">Restaurar como pausada</button></div>':
 '<details class="task-actions-disclosure"><summary>Gerenciar tarefa <span aria-hidden="true">⌄</span></summary><div class="task-controls">'+(t.inQueue?
 '<button class="secondary" data-task-action="up" data-task-id="'+taskId+'" title="Adiantar na ordem de execução">↑ Subir</button>'+
 '<button class="secondary" data-task-action="down" data-task-id="'+taskId+'" title="Atrasar na ordem de execução">↓ Descer</button>'+
 '<button class="secondary" data-task-action="pause" data-task-id="'+taskId+'">Pausar</button>':
 /pausada|cancelada/.test(t.status)?'<button class="secondary" data-task-action="resume" data-task-id="'+taskId+'">Devolver à fila</button>':'')+
 (t.inQueue||t.status==='pausada'?
 '<label class="task-setting">Prioridade <select data-task-priority="'+taskId+'" aria-label="Alterar prioridade da tarefa">'+
 ['P0','P1','P2','P3'].map(p=>'<option value="'+p+'"'+(t.priority===p?' selected':'')+'>'+({P0:'Urgente',P1:'Alta',P2:'Normal',P3:'Baixa'}[p])+'</option>').join('')+'</select></label>'+
 '<label class="task-setting">Agente <select data-task-agent="'+taskId+'" aria-label="Configurar agente responsável">'+
 Object.keys(AGENT_NAMES).map(id=>'<option value="'+id+'"'+(t.agent===id?' selected':'')+'>'+escapeHTML(label(id))+'</option>').join('')+'</select></label>':'')+
 (t.status!=='arquivada'?'<button class="secondary" data-task-action="archive" data-task-id="'+taskId+'">Excluir da lista</button>':'')+
 '</div></details>'+
 (t.inQueue||t.status==='pausada'?'<details class="task-editor" data-editor="'+taskId+'"'+(editPanels.has(t.id)?' open':'')+'><summary>Editar solicitação e posição</summary>'+
 '<label>Instrução original<textarea data-edit-objective="'+taskId+'" maxlength="2800">'+escapeHTML(taskDrafts.get(t.id)??String(t.description||'').replace(/^P[0-3]\s*\|\s*/,''))+'</textarea></label>'+
 '<button class="secondary" data-save-objective="'+taskId+'">Salvar instrução</button>'+
 (t.inQueue?'<div class="task-move"><label>Posição na fila <input data-move-position="'+taskId+'" type="number" min="1" max="'+Math.max(1,(snapshot?.tasks||[]).filter(x=>x.inQueue).length)+'" value="'+(t.queuePosition||1)+'"></label>'+
 '<button class="secondary" data-move-task="'+taskId+'">Mover para posição</button></div>':'')+'</details>':'');
 const diagnosis=t.supervision?'<section class="wait-diagnosis" aria-label="Diagnóstico do supervisor"><b>Supervisor · Situação real</b>'+
  '<p>'+escapeHTML(pendingDiagnosis||waitDescription(t.supervision.reason,t.supervision.retryReason))+'</p>'+
  (t.supervision.firstPendingTask?'<small>Primeira etapa: '+escapeHTML(t.supervision.firstPendingTask)+'</small>':'')+
  (t.supervision.checkedAt?'<small> · Conferido: '+escapeHTML(time(t.supervision.checkedAt))+'</small>':'')+
  '</section>':'';
 const detail='<div class="task-detail"><button type="button" class="mobile-detail-close" data-detail-close="'+taskId+'">← Voltar às tarefas</button>'+live+diagnosis+controls+
 '<p class="smallprint">'+(t.inQueue?'Esta tarefa está na fila do servidor.':
 'Esta tarefa não está na fila atual. O registro anterior pode ser consultado no histórico.')+'</p>'+
 (t.blocker?'<p class="error">Problema: '+escapeHTML(t.blocker)+'</p>':'')+
 checklist+'<h3 class="stages-heading">Etapas, motivos e retomada</h3>'+steps+
 '<details><summary class="history-toggle">Ver comprovantes e validação</summary>'+
 '<div class="detail-grid"><div><small>Responsável</small><b>'+escapeHTML(label(t.agent))+'</b></div>'+
 '<div><small>Situação</small><b>'+escapeHTML(emPortugues(t.rawStatus))+'</b></div>'+
 '<div><small>Testes</small><b>'+(t.approved?'Aprovados':'Sem aprovação comprovada')+'</b></div>'+
 '<div><small>Publicação</small><b>'+(t.published?'Confirmada':'Não confirmada')+'</b></div></div></details>'+
 '<a class="linkrow" href="#historico">Abrir histórico completo →</a></div>';
 return '<div class="task-row">'+(!PAGES_MODE&&t.status!=='arquivada'?'<input class="task-checkbox" type="checkbox" data-select-task="'+escapeHTML(t.id)+'" aria-label="Selecionar tarefa '+escapeHTML(t.id)+'"'+(taskSelections.has(t.id)?' checked':'')+'>':'')+'<div><div class="name">'+escapeHTML(t.project)+(t.queuePosition?' · #'+t.queuePosition+' na fila':'')+'</div><div class="details">'+escapeHTML(t.title)+'</div>'+
 (latest?'<div class="recent-action">'+escapeHTML(acaoEmPortugues(latest.action,latest.path))+'</div>':'')+
 (pendingDiagnosis?'<div class="pending-reason">'+escapeHTML(pendingDiagnosis)+'</div>':'')+
 (validProgress?'<div class="tiny-progress">'+progress.done+'/'+progress.total+' etapas com resultado</div>':'')+'</div>'+
 chip(t.status)+'<button class="linkrow" data-detail="'+escapeHTML(t.id)+'" aria-expanded="false">Acompanhar ▾</button>'+
 '<div class="inline-detail" id="detail-'+escapeHTML(t.id)+'" hidden>'+detail+'</div></div>';
}
function listTasks(tasks,limit=0){
 const list=limit?tasks.slice(0,limit):tasks;
 return list.length?'<div class="list">'+list.map(taskRow).join('')+'</div>':
 '<div class="empty">Nenhuma tarefa encontrada nos registros consultados. Se não houver fila ativa, o painel preserva resultados históricos separadamente.</div>';
}
function projectOptions(){return repoList.length?repoList.map(r=>'<option value="'+escapeHTML(r.repository)+'"'+(selectedRepository===r.repository?' selected':'')+'>'+escapeHTML(r.label)+'</option>').join(''):
 '<option value="">'+escapeHTML(repoLoadError?'Não foi possível consultar os projetos':'Consultando seus projetos...')+'</option>';}
function agentOptions(){return '<option value="may-maestro">Distribuição automática (Maestro)</option>'+Object.keys(AGENT_NAMES).filter(x=>x!=='may-maestro').map(id=>'<option value="'+id+'">'+escapeHTML(label(id))+'</option>').join('');}

async function loadRepositories(){
 try{
  let data;
  if(PAGES_MODE){
   const response=await fetch('https://api.github.com/users/danielnep/repos?per_page=100&type=owner',{cache:'no-store'});
   if(!response.ok)throw Error('Consulta pública indisponível');
   const repos=await response.json();
   data={repositories:repos.filter(r=>r?.owner?.login==='danielnep'&&r.private!==true&&!r.archived).map(r=>({
    repository:r.full_name,name:r.name,label:r.name.replace(/-/g,' ')
   }))};
  }else data=await api('repositories');
  repoList=(data.repositories||[]).filter(r=>/^danielnep\/[a-z0-9._-]+$/i.test(r.repository));
  repoLoadError=null;
  if(repoList.length&&!repoList.some(r=>r.repository===selectedRepository))selectedRepository=repoList[0].repository;
 }catch(e){repoLoadError=e.message;repoList=[];}
 if(active()==='inicio'||active()==='estudio')render();
}

function requestForm(){
 return '<section class="panel request" aria-label="Nova solicitação"><div class="request-head"><h2>O que os agentes precisam fazer?</h2><span class="smallprint">Central Horizon</span></div>'+
 '<form id="task-form"><textarea id="objective" name="objective" placeholder="Ex.: Corrija o login do Ronda Pro. Mantenha a interface aprovada e teste no celular." required minlength="12" maxlength="2800">'+escapeHTML(draft)+'</textarea>'+
 '<div class="request-meta"><div class="field"><label for="project">Meu projeto</label><select id="project" name="project" required'+(!repoList.length?' disabled':'')+'>'+projectOptions()+'</select></div>'+
 '<div class="field"><label for="priority">Prioridade</label><select id="priority" name="priority"><option value="P2">Normal</option><option value="P1">Alta</option><option value="P0">Urgente</option><option value="P3">Baixa</option></select></div>'+
 '<div class="field"><label for="agent">Responsável</label><select id="agent" name="agent">'+agentOptions()+'</select></div></div>'+
 (repoLoadError?'<p class="error">Não consegui consultar seus repositórios. <button type="button" class="quiet" id="retry-repos">Tentar novamente</button></p>':'<p class="smallprint">'+repoList.length+' repositórios encontrados. A Central identifica os arquivos permitidos automaticamente.</p>')+
 '<div class="request-actions"><span class="smallprint">Você acompanha a tarefa logo abaixo após enviar.</span>'+
 '<div class="actions-right"><button type="button" class="secondary" id="ai-action">Analisar com IA</button><button type="submit" class="primary" id="task-submit"'+(!repoList.length?' disabled':'')+'>Enviar solicitação ↑</button></div></div>'+
 '<div id="ai-result" class="assist-result" hidden aria-live="polite"></div></form></section>';
}
function overviewMarkup(){
 return summary()+'<div class="section-heading"><h2>Operações e pendências</h2><a class="linkrow" href="#tarefas">Ver todas →</a></div>'+
 listTasks(snapshot?.tasks||[],7)+(!snapshot?.available?.queue?'<p class="error">Fila da VPS indisponível: não é possível confirmar que está vazia.</p>':'')+
 (snapshot?.issues?.length?'<div class="smallprint warning">'+snapshot.issues.map(escapeHTML).join(' • ')+'</div>':'')+
 '<div class="section-heading"><h2>Agentes</h2><a class="linkrow" href="#agentes">Ver os 17 →</a></div>'+
 '<div class="compact-agent-list">'+(snapshot?.agents||[]).slice(0,5).map(a=>'<div><span>'+escapeHTML(label(a.id))+'</span>'+chip(a.status)+'</div>').join('')+'</div>'+
 '<div class="section-heading"><h2>Consumo de IA</h2><a class="linkrow" href="#consumo">Detalhar →</a></div>'+
 '<p class="smallprint">Tokens dos agentes: '+(snapshot?.usage?.total===null||snapshot?.usage?.total===undefined?'ainda não informados pelo executor':escapeHTML(snapshot.usage.total))+
 '. Atualizações desta tela não gastam tokens.</p>';
}
function pageInicio(){
 return heading('Central de agentes','Solicite, acompanhe e intervenha sem abrir outra conversa.')+(PAGES_MODE?'<section class="panel request"><h2>Modo acompanhamento</h2><p class="subtitle">Dados dos agentes indisponíveis neste modo. Abra a Central hospedada na VPS para administrar.</p></section>':requestForm())+
 '<section id="live-overview" aria-label="Situação atual da equipe">'+overviewMarkup()+'</section>';
}
function pageTarefas(){
 const tasks=!snapshot?.available?.vps?[]:filter==='arquivada'?archivedTasks:(snapshot?.tasks||[]);const text=term.toLocaleLowerCase('pt-BR');
 const filtered=tasks.filter(t=>(filter==='todos'||(filter==='fora'?!t.inQueue:t.status===filter))&&(!text||[t.project,t.id,t.title,t.agent].join(' ').toLocaleLowerCase('pt-BR').includes(text)));
 return heading('Tarefas','Solicitações registradas na fila e os respectivos resultados verificáveis.')+
 '<div class="searchbar"><input id="search" placeholder="Buscar por projeto ou tarefa…" aria-label="Buscar tarefas" value="'+escapeHTML(term)+'">'+
 '<select id="filter"><option value="todos">Todas, inclusive histórico</option><option value="fora">Fora da fila</option><option value="arquivada">Excluídas (recuperáveis)</option><option value="em execução">Em execução</option><option value="aguardando">Aguardando</option><option value="na fila">Na fila</option><option value="bloqueada">Bloqueada</option><option value="concluída">Concluída</option></select></div>'+
 '<div class="section-heading"><h2>'+filtered.length+' solicitações</h2><span class="meta">Fonte: fila e resultados da VPS</span></div>'+
 (filter==='arquivada'?'':'<div class="bulk-toolbar"><label><input type="checkbox" id="select-visible" aria-label="Selecionar tarefas visíveis"> Selecionar visíveis</label>'+
 '<span id="selected-count">'+taskSelections.size+' selecionadas</span>'+
 '<button class="secondary" data-bulk="pause">Pausar</button><button class="secondary" data-bulk="cancel">Cancelar</button><button class="secondary" data-bulk="archive">Excluir da lista</button></div>')+
 listTasks(filtered);
}
function agentRow(a){
 return '<div class="agent-row"><div><div class="name">'+escapeHTML(label(a.id))+'</div><div class="details">'+escapeHTML(a.currentTask||'Nenhuma tarefa individual identificada')+'</div></div>'+
 chip(a.held?'novas tarefas pausadas':a.status)+'<button class="linkrow" data-agent="'+escapeHTML(a.id)+'">Ver agente →</button>'+
 (selectedAgent===a.id?'<div class="inline-detail">Agente: '+escapeHTML(a.id)+'\nEstado: '+escapeHTML(a.status)+'\nAtividade: '+escapeHTML(a.currentTask||'não verificada')+'\nÚltimo registro: '+escapeHTML(time(a.updatedAt))+'<div class="task-controls"><button class="secondary" data-assign-agent="'+escapeHTML(a.id)+'">Atribuir tarefa</button><button class="secondary" data-agent-action="'+(a.held?'resume':'pause')+'" data-agent-id="'+escapeHTML(a.id)+'">'+(a.held?'Liberar novas tarefas':'Pausar novas tarefas')+'</button></div>'+
 agentConfigMarkup(a.id)+'<p class="smallprint">As configurações limitam as novas tarefas aceitas. Uma etapa iniciada pode continuar.</p></div>':'')+'</div>';
}
function agentConfigMarkup(id){
 if(PAGES_MODE)return '';
 const cfg=agentDrafts.get(id)||agentConfigs.get(id);
 if(!cfg)return '<p class="smallprint">Carregando configurações do agente...</p>';
 return '<form class="agent-config" data-agent-config="'+escapeHTML(id)+'">'+
 '<label>Limite de tarefas na fila (0 = sem limite) <input type="number" min="0" max="50" name="maxPending" value="'+cfg.maxPending+'"></label>'+
 '<label>Repositórios permitidos, separados por vírgula (vazio = todos) <textarea name="allowedRepositories" rows="2">'+escapeHTML(cfg.allowedRepositories.join(', '))+'</textarea></label>'+
 '<label>Observações administrativas <textarea name="notes" rows="2" maxlength="240">'+escapeHTML(cfg.notes)+'</textarea></label>'+
 '<button class="primary" type="submit">Salvar configuração do agente</button></form>';
}
function pageAgentes(){
 const a=snapshot?.agents||[];
 return heading('Os 17 especialistas','Estado individual apenas quando houver registro concreto de execução.')+
 '<div class="summary"><span><b>17</b> cadastrados</span><span>Atualização individual conforme registros disponíveis</span></div>'+
 '<div class="list">'+(snapshot?.available?.vps?a.map(agentRow).join(''):'<div class="empty">VPS desconectada. Nenhum estado individual pode ser confirmado.</div>')+'</div>';
}

function explainEvent(e){
 const event=String(e?.event||'');
 const reason=String(e?.reason||'');
 if(event==='cycle_failed')return 'O executor encontrou um problema e não terminou essa tentativa. A causa exata precisa ser investigada.';
 if(event==='cycle'&&String(e.rc)==='0')return 'O ciclo técnico terminou sem erro. Isso não significa que as tarefas foram concluídas.';
 if(event==='cycle'&&String(e.rc)==='1')return 'O ciclo falhou. É necessário consultar o erro de origem para corrigir.';
 if(event==='provider_probe_failure'&&reason==='quota')return 'Gemini atingiu o limite de consultas. O sistema deve tentar o modelo alternativo.';
 if(event==='provider_probe_failure'&&reason==='server')return 'Gemini teve uma falha temporária no serviço. O sistema deve recorrer ao modelo alternativo.';
 if(event==='provider_probe')return 'Um dos modelos de IA respondeu ao teste de conexão.';
 if(event==='requests_refreshed')return 'O executor atualizou a lista de tarefas.';
 if(event==='snapshot_changed')return 'Mudança identificada nas tarefas ou nos agentes.';
 if(event==='submitted')return 'Uma nova solicitação foi recebida.';
 if(event==='control')return 'Comando aplicado à fila. Consulte o estado atualizado da tarefa.';
 return 'Houve uma atualização técnica no servidor.';
}

function pageHistorico(){
 const events=snapshot?.available?.vps?snapshot?.events||[]:[];
 return heading('Histórico','Resultados confirmados pela VPS e eventos recentes da equipe.')+
 '<div class="section-heading"><h2>Resultados armazenados</h2><span class="meta">Mesmo após sair da fila</span></div>'+listTasks((snapshot?.tasks||[]).filter(x=>x.hasResult))+
 '<div class="section-heading"><h2>Atividade recente do servidor</h2></div>'+
 (!events.length?'<div class="empty">Ainda não há eventos recentes da equipe nesta instância.</div>':
 '<div class="list">'+[...events].reverse().map(e=>
 '<div class="event-row"><time>'+escapeHTML(time(e.at))+'</time><div><strong>'+escapeHTML(e.kind==='worker'?'Execução':'Atividade da Central')+'</strong>'+
 '<p>'+escapeHTML(explainEvent(e))+'</p><details><summary class="smallprint">Ver dados técnicos</summary><p>'+escapeHTML(Object.entries(e).filter(([k])=>!['id','at','kind','event'].includes(k)).map(([k,v])=>k+': '+v).join(' • ')||'Sem detalhes adicionais')+'</p></details></div></div>').join('')+'</div>')+
 '<p class="smallprint">Reiniciar o servidor limpa apenas este painel de eventos recentes, não os registros permanentes do executor.</p>';
}
function pageConsumo(){
 const u=snapshot?.available?.vps?snapshot?.usage||{}:{available:false},fmt=x=>Number.isFinite(x)?x.toLocaleString('pt-BR'):'—';
 const providers=Object.entries(u.byProvider||{}).sort((a,b)=>b[1].total-a[1].total);
 const agents=Object.entries(u.byAgent||{}).sort((a,b)=>b[1].total-a[1].total);
 return heading('Consumo de inteligência artificial','Quantidade recebida diretamente do Gemini e da Groq, sem estimativas inventadas.')+
 '<div class="stat-strip"><div><small>Tokens enviados</small><strong>'+fmt(u.available?u.input:null)+'</strong></div>'+
 '<div><small>Tokens recebidos</small><strong>'+fmt(u.available?u.output:null)+'</strong></div>'+
 '<div><small>Consumo total</small><strong>'+fmt(u.available?u.total:null)+'</strong></div></div>'+
 '<p class="smallprint">'+(u.available?u.calls+' respostas contabilizadas nos últimos '+u.days+' dias.':
 'Nenhuma resposta com consumo identificado desde o início do registro.')+
 (u.partial?' Parte dos registros não pôde ser consultada.':'')+'</p>'+
 '<div class="section-heading"><h2>Por serviço de IA</h2></div>'+
 (providers.length?'<div class="list">'+providers.map(([name,d])=>'<div class="agent-row"><div><div class="name">'+escapeHTML(name==='central-groq'?'Ajuda da Central (Groq)':name==='groq'?'Groq':'Gemini')+
 '</div><div class="details">'+d.calls+' chamadas</div></div><strong>'+fmt(d.total)+' tokens</strong></div>').join('')+'</div>':
 '<div class="empty">Nenhum consumo dos provedores foi recebido ainda.</div>')+
 '<div class="section-heading"><h2>Por especialista</h2></div>'+
 (agents.length?'<div class="list">'+agents.map(([id,d])=>'<div class="agent-row"><div><div class="name">'+escapeHTML(label(id))+
 '</div><div class="details">'+d.calls+' chamadas</div></div><strong>'+fmt(d.total)+' tokens</strong></div>').join('')+'</div>':
 '<div class="empty">Aguardando os primeiros registros individuais.</div>');
}
function simpleDiagnosis(e){
 const code=String(e?.rc||e?.code||'');
 const reason=String(e?.reason||e?.errorClass||'');
 if(reason==='quota'||code==='429')return 'Gemini atingiu seu limite. O sistema deve alternar para Groq.';
 if(reason==='server'||code==='503')return 'O provedor de IA está temporariamente indisponível. É necessário usar o alternativo.';
 if(reason==='RuntimeError'||code==='1'||e?.kind==='cycle_failed')return 'A execução falhou. Este registro não identifica a causa exata. É preciso investigar o erro interno.';
 if(code==='0')return 'O ciclo terminou sem erro técnico. Isso não confirma entrega de tarefa.';
 return 'Sem informações suficientes para identificar a causa de um erro.';
}
function pageSistema(){
 const w=snapshot?.worker||{status:'sem dados'};
 const last=w.lastCycle||{};
 return heading('Saúde do sistema','O que aconteceu, o que significa e como resolver.')+
 '<section class="panel"><div class="diagnosis">'+escapeHTML(simpleDiagnosis(last))+'</div><div class="section-heading"><h2>Execução Horizon</h2>'+chip(w.status)+'</div>'+
 '<div class="detail-grid">'+
 '<div><small>Serviço desta central</small><b>'+escapeHTML(online?'Conectado':'Sem confirmação de conexão')+'</b></div>'+
 '<div><small>Worker</small><b>'+escapeHTML(w.status||'não verificado')+'</b></div>'+
 '<div><small>Último ciclo visto</small><b>'+escapeHTML(time(last.at))+'</b></div>'+
 '<div><small>Resultado do último ciclo</small><b>'+escapeHTML(last.rc??last.code??'não informado')+'</b></div>'+
 '<div><small>Fonte de tarefas</small><b>'+escapeHTML(snapshot?.available?.queue?'Fila local consultada':'Fila local indisponível')+'</b></div>'+
 '<div><small>Presença dos agentes</small><b>'+escapeHTML(snapshot?.available?.attendance?'Registros consultados':'Sem confirmação individual')+'</b></div></div>'+
 '<p class="smallprint">Explicação baseada no último registro, sem inventar causas.</p><div class="task-controls"><button type="button" class="secondary" id="diagnose-ai">Investigar com IA</button></div><div id="diagnosis-result" class="diagnosis" hidden></div></section>'+
 '<div class="section-heading"><h2>Conexão</h2></div><div class="smallprint">Atualizações por SSE, com reconexão e atualização periódica de segurança. Nada de IA para sincronizar estados.</div>';
}

function studioProgress(){
 const active=(snapshot?.tasks||[]).filter(t=>t.inQueue).slice(0,5);
 return '<h2>Agentes trabalhando</h2>'+
 (active.length?active.map(t=>'<div class="studio-progress-line"><strong>'+escapeHTML(String(t.title||t.project||'Tarefa').slice(0,68))+'</strong>'+
 chip(t.status)+'</div>').join(''):'<p class="smallprint">Nenhuma tarefa em execução confirmada. Envie uma solicitação para acompanhar o progresso.</p>')+
 '<p class="smallprint">Indicadores da fila local do servidor. O preview abre a publicação real do projeto.</p>';
}
function pageEstudio(){
 return heading('Estúdio de criação','Converse com os especialistas e veja o aplicativo no celular ou desktop.')+
 '<div class="studio-layout"><div class="studio-compose">'+
 (PAGES_MODE?'<section class="panel request"><h2>Prévia do projeto</h2><p class="subtitle">No GitHub Pages, o estúdio funciona em modo de acompanhamento.</p></section>':requestForm())+
 '<section id="studio-progress" class="studio-progress" aria-label="Atividade real dos agentes">'+studioProgress()+'</section>'+
 '</div>'+studioMarkup(repoList)+'</div>';
}
let renderedPage=null;
function render(){
 updateMenu();const page=active();
 if(page==='estudio'&&renderedPage==='estudio'&&$('studio-root')&&$('studio-project')?.options.length===repoList.length){
  const progress=$('studio-progress');if(progress)progress.innerHTML=studioProgress();
  notifyStudioChanged();updateConn();return;
 }
 if(renderedPage==='estudio')stopStudio();
 const template={inicio:pageInicio,estudio:pageEstudio,tarefas:pageTarefas,agentes:pageAgentes,historico:pageHistorico,consumo:pageConsumo,sistema:pageSistema}[page];
 const content=$('content');content.innerHTML=template();$('logout').hidden=!adminAuthorized||PAGES_MODE;
 renderedPage=page;bind();repaintAnalysis();
 for(const id of openTasks){
  const detail=$('detail-'+id),trigger=[...document.querySelectorAll('[data-detail]')].find(x=>x.dataset.detail===id);
  if(detail&&trigger){detail.hidden=false;trigger.setAttribute('aria-expanded','true');trigger.textContent='Recolher ▴';}
 }
 if(page==='estudio')mountStudio({repositories:repoList,onProjectChange:repository=>{
 selectedRepository=repository;const selector=$('project');if(selector&&[...selector.options].some(o=>o.value===repository))selector.value=repository;
 }});updateConn();
}


function janelaDeAcao(title,explanation){
 return new Promise(resolve=>{
  const modal=$('action-gate'),continueButton=$('action-continue'),back=$('action-back');
  $('action-title').textContent=title;
  $('action-explanation').textContent=explanation;
  modal.hidden=false;continueButton.disabled=true;
  let seconds=3;
  $('action-countdown').textContent='Leia o aviso: '+seconds+' segundos';
  function close(ok){
   clearInterval(actionTimer);
   modal.hidden=true;continueButton.onclick=null;back.onclick=null;
   resolve(ok);
  }
  continueButton.onclick=()=>close(true);
  back.onclick=()=>close(false);
  back.focus();
  actionTimer=setInterval(()=>{
   seconds--;
   if(seconds<=0){
    clearInterval(actionTimer);
    $('action-countdown').textContent='Você pode continuar ou voltar.';
    continueButton.disabled=false;
   }else $('action-countdown').textContent='Leia o aviso: '+seconds+' segundos';
  },1000);
 });
}

async function executeAgentAction(id,action,skipConfirm=false){
 if(!skipConfirm&&!await janelaDeAcao(action==='pause'?'Pausar este agente?':'Liberar este agente?',action==='pause'?'O agente não receberá novas tarefas. Se já estiver trabalhando, poderá terminar a etapa atual. Você pode liberá-lo depois.':'As tarefas suspensas voltarão para a fila. Nenhuma tarefa cancelada será reiniciada sem sua decisão.'))return;
 try{
  const result=await api('agents/'+encodeURIComponent(id)+'/action',{method:'POST',body:JSON.stringify({action})});
  note(result.note||'Estado do agente atualizado.');
  pendingCommand=null;await refresh(true);
 }catch(e){
  if(e.message.includes('autorização')||e.message.includes('autorizacao')){pendingCommand={id,action,type:'agent'};note('Autorize o dispositivo para acionar o agente.',true);}
  else note(e.message,true);
 }
}
async function executeTaskAction(id,action,skipConfirm=false,settings={}){
 if(!skipConfirm&&!await janelaDeAcao(action==='archive'?'Excluir esta tarefa da lista?':action==='cancel'?'Cancelar esta tarefa?':action==='pause'?'Pausar esta tarefa?':'Devolver para a fila?',action==='archive'?'A tarefa será retirada da fila e colocada em Excluídas, preservando resultados e recuperação. Uma etapa já carregada pelo executor pode terminar.':action==='cancel'?'Ela sairá da fila de execução, mas seu histórico será guardado. Se um agente já tiver iniciado a etapa, a conclusão dessa execução não poderá ser interrompida por este comando.':action==='pause'?'A tarefa ficará suspensa e poderá ser retomada depois. Se o trabalho já começou, a etapa atual pode continuar.':'A tarefa voltará para a fila. Ela será assumida pelo executor conforme a disponibilidade, sem garantia de início imediato.'))return;
 try{
  const result=await api('tasks/'+encodeURIComponent(id)+'/action',{method:'POST',body:JSON.stringify({action,...settings})});
  note(result.note||'Comando aplicado no servidor.');pendingCommand=null;
  if(filter==='arquivada')archivedTasks=(await api('tasks/archived')).tasks||[];
  await refresh(true);
 }catch(e){
  if(e.message.includes('autorização')||e.message.includes('autorizacao')){
   pendingCommand={id,action,type:'task',settings};
   note('Para controlar execuções, autorize o dispositivo uma vez.',true);
  }else note(e.message,true);
 }
}
function bindTaskActions(root=document){
 root.querySelectorAll('[data-task-action]').forEach(btn=>btn.addEventListener('click',()=>{
  const action=btn.dataset.taskAction;
  void executeTaskAction(btn.dataset.taskId,action,['up','down','restore'].includes(action));
 }));
 root.querySelectorAll('[data-task-priority]').forEach(select=>select.addEventListener('change',()=>void executeTaskAction(select.dataset.taskPriority,'priority',true,{priority:select.value})));
 root.querySelectorAll('[data-task-agent]').forEach(select=>select.addEventListener('change',()=>void executeTaskAction(select.dataset.taskAgent,'assign',true,{agent:select.value})));
 root.querySelectorAll('[data-editor]').forEach(panel=>panel.addEventListener('toggle',()=>{if(panel.open)editPanels.add(panel.dataset.editor);else editPanels.delete(panel.dataset.editor)}));
 root.querySelectorAll('[data-edit-objective]').forEach(field=>field.addEventListener('input',()=>taskDrafts.set(field.dataset.editObjective,field.value)));
 root.querySelectorAll('[data-save-objective]').forEach(btn=>btn.addEventListener('click',()=>void executeTaskAction(btn.dataset.saveObjective,'edit',true,{objective:root.querySelector('[data-edit-objective="'+btn.dataset.saveObjective+'"]').value})));
 root.querySelectorAll('[data-move-task]').forEach(btn=>btn.addEventListener('click',()=>void executeTaskAction(btn.dataset.moveTask,'move',true,{position:Number(root.querySelector('[data-move-position="'+btn.dataset.moveTask+'"]').value)})));
 root.querySelectorAll('[data-select-task]').forEach(check=>check.addEventListener('change',()=>{if(check.checked)taskSelections.add(check.dataset.selectTask);else taskSelections.delete(check.dataset.selectTask);const count=$('selected-count');if(count)count.textContent=taskSelections.size+' selecionadas';}));
 const all=$('select-visible');if(all)all.addEventListener('change',()=>{root.querySelectorAll('[data-select-task]').forEach(check=>{check.checked=all.checked;if(all.checked)taskSelections.add(check.dataset.selectTask);else taskSelections.delete(check.dataset.selectTask)});const count=$('selected-count');if(count)count.textContent=taskSelections.size+' selecionadas';});
 root.querySelectorAll('[data-bulk]').forEach(btn=>btn.addEventListener('click',async()=>{
  const ids=[...taskSelections];if(!ids.length){note('Selecione as tarefas primeiro.',true);return;}
  const action=btn.dataset.bulk;
  const yes=await janelaDeAcao('Aplicar ação a '+ids.length+' tarefas?',action==='archive'?'As tarefas selecionadas sairão da lista ativa e poderão ser restauradas.':'As tarefas selecionadas serão alteradas na fila do servidor.');
  if(!yes)return;
  btn.disabled=true;let done=0,failed=0;
  for(const id of ids){try{await api('tasks/'+encodeURIComponent(id)+'/action',{method:'POST',body:JSON.stringify({action})});done++;taskSelections.delete(id);}
   catch{failed++;}}
  btn.disabled=false;note(done+' tarefas atualizadas; '+failed+' sem alteração.',failed>0);await refresh(true);
 }));
 root.querySelectorAll('[data-agent-action]').forEach(btn=>btn.addEventListener('click',()=>executeAgentAction(btn.dataset.agentId,btn.dataset.agentAction)));
}

function closeTaskDetail(id){
 const detail=document.getElementById('detail-'+id);
 const trigger=[...document.querySelectorAll('[data-detail]')].find(x=>x.dataset.detail===id);
 if(!detail||!trigger)return;
 detail.hidden=true;openTasks.delete(id);
 trigger.setAttribute('aria-expanded','false');trigger.textContent='Acompanhar ▾';
 trigger.focus({preventScroll:true});
}
function bindTaskDetailClose(root=document){
 root.querySelectorAll('[data-detail-close]').forEach(el=>el.addEventListener('click',()=>closeTaskDetail(el.dataset.detailClose)));
}
function bind(){
 bindTaskDetailClose();
 document.querySelectorAll('[data-detail]').forEach(el=>el.addEventListener('click',()=>{
 const target=document.getElementById('detail-'+el.dataset.detail);if(!target)return;
 target.hidden=!target.hidden;if(target.hidden)openTasks.delete(el.dataset.detail);else openTasks.add(el.dataset.detail);
 el.setAttribute('aria-expanded',String(!target.hidden));el.textContent=target.hidden?'Detalhes ▾':'Recolher ▴';
 }));
 document.querySelectorAll('[data-agent]').forEach(el=>el.addEventListener('click',async()=>{
 selectedAgent=selectedAgent===el.dataset.agent?null:el.dataset.agent;
 if(selectedAgent&&!agentConfigs.has(selectedAgent))try{agentConfigs.set(selectedAgent,await api('agents/'+selectedAgent+'/config'));}
 catch(e){note(e.message,true);}
 render();
 }));
 document.querySelectorAll('[data-agent-config]').forEach(form=>form.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=form.dataset.agentConfig,input=new FormData(form);
  const data={maxPending:Number(input.get('maxPending')),allowedRepositories:String(input.get('allowedRepositories')||'').split(',').map(x=>x.trim()).filter(Boolean),notes:String(input.get('notes')||'')};
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{agentConfigs.set(id,await api('agents/'+id+'/config',{method:'POST',body:JSON.stringify(data)}));agentDrafts.delete(id);note('Configuração do agente salva no servidor.');}
  catch(error){note(error.message,true);}finally{button.disabled=false;}
 }));
 document.querySelectorAll('[data-agent-config] textarea,[data-agent-config] input').forEach(field=>field.addEventListener('input',()=>{
  const form=field.closest('form[data-agent-config]'),fd=new FormData(form),id=form.dataset.agentConfig;
  agentDrafts.set(id,{maxPending:Number(fd.get('maxPending')),allowedRepositories:String(fd.get('allowedRepositories')||'').split(',').map(x=>x.trim()).filter(Boolean),notes:String(fd.get('notes')||'')});
 }));
 const search=$('search');if(search)search.addEventListener('input',()=>{term=search.value;render();$('search')?.focus();$('search')?.setSelectionRange(term.length,term.length)});
 const dropdown=$('filter');if(dropdown){dropdown.value=filter;dropdown.addEventListener('change',async()=>{filter=dropdown.value;
  if(filter==='arquivada')try{archivedTasks=(await api('tasks/archived')).tasks||[];}
  catch(e){note('Entre como administrador para consultar as tarefas excluídas.',true);filter='todos';}
  render();
 });}
 const objective=$('objective');if(objective)objective.addEventListener('input',()=>draft=objective.value);
 document.querySelectorAll('[data-assign-agent]').forEach(btn=>btn.addEventListener('click',()=>{selectedAgentId=btn.dataset.assignAgent;location.hash='#inicio';render();$('objective')?.focus();}));
 bindTaskActions(document);
 const diagnosis=$('diagnose-ai');if(diagnosis)diagnosis.addEventListener('click',()=>void runAnalysis('diagnose','ai/diagnose',{}));
 const form=$('task-form');
 if(form){
 const project=$('project');
 project.value=selectedRepository;
 $('priority').value=selectedPriority;
 $('agent').value=selectedAgentId;
 project.addEventListener('change',()=>{selectedRepository=project.value;if(active()==='estudio'){const picker=$('studio-project');if(picker&&picker.value!==selectedRepository){picker.value=selectedRepository;picker.dispatchEvent(new Event('change'));}}});
 $('priority').addEventListener('change',()=>{selectedPriority=$('priority').value;});
 $('agent').addEventListener('change',()=>{selectedAgentId=$('agent').value;});
 const retry=$('retry-repos');if(retry)retry.addEventListener('click',()=>loadRepositories());
 $('ai-action').addEventListener('click',()=>{const message=objective.value.trim();if(message.length<12){note('Descreva a solicitação antes de analisar.',true);return;}void runAnalysis('request','ai/interpret',{message});});
 form.addEventListener('submit',async e=>{e.preventDefault();const b=$('task-submit');if(b.disabled)return;
 const repository=project.value;
 if(!repoList.some(r=>r.repository===repository)){note('Selecione um projeto da lista.',true);return;}
 const value={objective:objective.value.trim(),repository,project:repository.split('/')[1].toLowerCase(),priority:selectedPriority,agent:selectedAgentId,
 delivery_type:'existing_product',public_data_confirmed:true};
 b.disabled=true;b.textContent='Enviando...';
 try{const saved=await api('tasks',{method:'POST',body:JSON.stringify(value)});draft='';note('Solicitação '+saved.id+' enviada. A execução ainda não foi comprovada.');await refresh(true);}
 catch(err){note(err.message,true);}finally{b.disabled=false;b.textContent='Enviar solicitação ↑';}
 });
 }
}
function updateConn(){
 const el=$('connection');el.className='connection '+(online?'ok':'off');
 const streaming=online&&!PAGES_MODE&&stream?.readyState===EventSource.OPEN;
 el.className='connection '+(!online?'off':streaming||PAGES_MODE?'ok':'');
 el.querySelector('span').textContent=online?(streaming?'VPS ao vivo':'VPS conectada'):'VPS desconectada';
}
async function refresh(force=false){
 if(refreshing)return refreshing;
 refreshing=(async()=>{
  try{const data=await api('overview');snapshot=data;online=data.available?.vps===true;
   const focused=document.activeElement;
   const formFocused=!force&&focused&&['TEXTAREA','INPUT','SELECT'].includes(focused.tagName)&&$('task-form')?.contains(focused);
   if(formFocused&&active()==='inicio'&&$('live-overview')){
    // Refresh tasks/agent status without clearing what the owner is typing.
    $('live-overview').innerHTML=overviewMarkup();
    document.querySelectorAll('#live-overview [data-detail]').forEach(el=>el.addEventListener('click',()=>{
      const target=document.getElementById('detail-'+el.dataset.detail);if(!target)return;
      target.hidden=!target.hidden;el.setAttribute('aria-expanded',String(!target.hidden));el.textContent=target.hidden?'Detalhes ▾':'Recolher ▴';
    }));
    bindTaskActions($('live-overview'));
    bindTaskDetailClose($('live-overview'));
    updateConn();
   }else render();
  }catch(e){online=false;updateConn();if(!snapshot)$('content').innerHTML='<div class="empty">Sem dados ao vivo: '+escapeHTML(e.message)+'. Verifique a sessão e tente novamente.</div>';}
 })().finally(()=>refreshing=null);
 return refreshing;
}
function connectEvents(){
 if(PAGES_MODE)return;
 if(stream){stream.close();stream=null;}
 stream=new EventSource('/central/api/events');
 stream.addEventListener('update',()=>{setTimeout(()=>refresh(),450)});
 stream.onopen=()=>updateConn();
 stream.onerror=()=>{if(!navigator.onLine)online=false;updateConn();};
}
async function boot(){
 showLogin(false);
 try{const session=await api('session');adminAuthorized=Boolean(session.authenticated);}catch{}
 await refresh(true);
 await loadRepositories();
 connectEvents();
}
$('close-gate').addEventListener('click',()=>showLogin(false));

function mensagemAjuda(role,text){
 const element=document.createElement('p');
 element.className='help-bubble '+(role==='user'?'from-me':'from-ai');
 element.textContent=String(text);
 $('help-messages').append(element);
 $('help-messages').scrollTop=$('help-messages').scrollHeight;
 return element;
}
$('help-open').addEventListener('click',()=>{
 const panel=$('help-panel');panel.hidden=!panel.hidden;
 $('help-open').setAttribute('aria-expanded',String(!panel.hidden));
 if(!panel.hidden)$('help-input').focus();
});
$('help-close').addEventListener('click',()=>{
 $('help-panel').hidden=true;$('help-open').setAttribute('aria-expanded','false');
});
$('help-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const input=$('help-input'),question=input.value.trim();if(question.length<3)return;
 input.value='';mensagemAjuda('user',question);
 const waiting=mensagemAjuda('assistant','Consultando as informações disponíveis...');
 const send=$('help-send');send.disabled=true;
 try{
  const output=await api('ai/chat',{method:'POST',body:JSON.stringify({message:question})});
  waiting.textContent=output.response||'Não encontrei informações suficientes para responder.';
  helpHistory.push({question,response:waiting.textContent});if(helpHistory.length>5)helpHistory.shift();
 }catch(err){
  waiting.textContent=err.message.includes('limite')?'O limite de consultas foi atingido. Tente novamente mais tarde.':
   'Não consegui consultar a ajuda agora. Os dados da Central continuam disponíveis nas outras telas.';
 }finally{send.disabled=false;$('help-input').focus();}
});

$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();$('login-error').textContent='';
 try{await api('login',{method:'POST',body:JSON.stringify({password:$('password').value})});
 $('password').value='';adminAuthorized=true;showLogin(false);note('Administração autorizada.');await refresh(true);
 if(pendingCommand){const command=pendingCommand;pendingCommand=null;if(command.type==='agent')await executeAgentAction(command.id,command.action,true);else await executeTaskAction(command.id,command.action,true,command.settings||{});}
 }catch(e){$('login-error').textContent=e.message;}
});
$('refresh').addEventListener('click',()=>refresh(true));
$('logout').addEventListener('click',async()=>{if(PAGES_MODE)return;try{await api('logout',{method:'POST'});}catch{}
 adminAuthorized=false;showLogin(false);note('Acesso administrativo encerrado. Acompanhamento continua livre.');render();});
window.addEventListener('hashchange',render);
window.addEventListener('online',()=>refresh(true));
window.addEventListener('offline',()=>{online=false;updateConn()});
setInterval(()=>refresh(),PAGES_MODE?120000:30000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>{const url=new URL('./sw.js',location.href);navigator.serviceWorker.register(url.pathname,{scope:new URL('./',url).pathname}).catch(()=>{});});
boot();