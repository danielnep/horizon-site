const $=id=>document.getElementById(id);
const AGENT_NAMES={
'may-maestro':'May Maestro','horizon-project-studio':'Estúdio Horizon','software-architect':'Arquitetura',
'frontend-engineer':'Frontend','backend-engineer':'Backend','mobile-app-builder':'Aplicativos Mobile',
'ui-ux-designer':'Design UI/UX','horizon-ui-guardian':'UI Guardian','database-engineer':'Banco de Dados',
'integration-engineer':'Integrações','qa-engineer':'QA / Testes','security-engineer':'Segurança',
'devops-engineer':'DevOps','horizon-evolution-agent':'Aprimoramento','horizon-skills':'Habilidades',
'corregedoria-may':'Corregedoria','may-persona':'May Persona'};
const LABELS={inicio:'Central de Agentes',tarefas:'Tarefas',agentes:'17 agentes',historico:'Histórico',consumo:'Consumo de tokens',sistema:'Sistema'};
const PROJECTS={
'ronda-pro':{name:'Ronda Pro',repository:'danielnep/app-hondas-maxvel'},
'michelle-preview':{name:'Painel Michelle',repository:'danielnep/michelle-preview'},
'horizon-site':{name:'Horizon Site',repository:'danielnep/horizon-site'},
'novo-projeto':{name:'Outro projeto',repository:'danielnep/'}};
let snapshot=null,online=false,stream=null,refreshing=null,term='',filter='todos',draft='',working=false,selectedAgent=null;
let noticeTimeout;
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function time(x){if(!x)return 'Não informado';const d=new Date(x);return Number.isNaN(d.getTime())?'Não informado':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);}
function label(id){return AGENT_NAMES[id]||id||'Não atribuído';}
function chip(s){
 const v=String(s||'não verificado');
 const cls=/bloque|falha|rejeit|erro/i.test(v)?'bad':/execu|conclu|ativo|iniciado/i.test(v)?'good':/aguard|fila/i.test(v)?'warn':'';
 return '<span class="chip '+cls+'">'+escapeHTML(v)+'</span>';
}
function note(txt,isError=false){
 const el=$('notice');clearTimeout(noticeTimeout);el.textContent=txt;el.hidden=false;el.style.borderColor=isError?'#ff867c':'#536273';noticeTimeout=setTimeout(()=>el.hidden=true,7500);
}
async function api(path,options={}){
 const response=await fetch('/central/api/'+path,{credentials:'same-origin',cache:'no-store',headers:options.body?{'content-type':'application/json'}:{},...options});
 let data;try{data=await response.json();}catch{data={error:'resposta_invalida'};}
 if(response.status===401){showLogin(true);throw Error('Sessão expirada. Entre novamente.');}
 if(!response.ok)throw Error(String(data.error||'Falha de comunicação').replaceAll('_',' '));
 return data;
}
function showLogin(show){$('gate').hidden=!show;$('shell').style.visibility=show?'hidden':'visible';if(show)$('password')?.focus();}
function active(){const x=(location.hash||'#inicio').replace(/^#/,'');return LABELS[x]?x:'inicio';}
function updateMenu(){
 const page=active();$('page-label').textContent=LABELS[page];
 document.querySelectorAll('[data-page]').forEach(x=>{x.classList.toggle('active',x.dataset.page===page);if(x.dataset.page===page)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
}
function heading(title,subtitle=''){return '<div class="page-head"><div><p class="eyebrow">HORIZON / OPERAÇÕES</p><h1>'+escapeHTML(title)+'</h1>'+(subtitle?'<p class="subtitle">'+escapeHTML(subtitle)+'</p>':'')+'</div><span class="time-label">'+(snapshot?'Atualizado '+time(snapshot.at):'Aguardando dados')+'</span></div>';}
function counts(){const t=snapshot?.tasks||[];return {total:t.length,active:t.filter(x=>x.status==='em execução').length,waiting:t.filter(x=>['aguardando','na fila','aguardando validação'].includes(x.status)).length,blocked:t.filter(x=>x.status==='bloqueada').length};}
function summary(){const c=counts();return '<div class="summary"><span class="working"><b>'+c.active+'</b> em execução</span><span><b>'+c.waiting+'</b> aguardando</span><span class="problem"><b>'+c.blocked+'</b> bloqueadas</span><span><b>17</b> especialistas cadastrados</span></div>';}
function taskRow(t){
 const detail=['Projeto: '+t.project,'Especialista: '+label(t.agent),'Prioridade: '+(t.priority||'não identificada'),
 'Situação do resultado: '+(t.rawStatus||'nenhum resultado registrado'),
 'QA aprovado: '+(t.approved?'sim':'não comprovado'),'Publicado: '+(t.published?'sim':'não comprovado'),
 'Registro: '+t.id].join('\n');
 return '<div class="task-row"><div><div class="name">'+escapeHTML(t.project)+'</div><div class="details">'+escapeHTML(t.title)+'</div></div>'+chip(t.status)+
 '<button class="linkrow" data-detail="'+escapeHTML(t.id)+'" aria-expanded="false">Detalhes ▾</button>'+
 '<div class="inline-detail" id="detail-'+escapeHTML(t.id)+'" hidden>'+escapeHTML(detail)+'</div></div>';
}
function listTasks(tasks,limit=0){
 const list=limit?tasks.slice(0,limit):tasks;
 return list.length?'<div class="list">'+list.map(taskRow).join('')+'</div>':
 '<div class="empty">Nenhuma tarefa registrada na fila consultada. Pronto para receber uma nova solicitação.</div>';
}
function projectOptions(){return Object.entries(PROJECTS).map(([id,p])=>'<option value="'+id+'">'+escapeHTML(p.name)+'</option>').join('');}
function agentOptions(){return '<option value="may-maestro">Distribuição automática (Maestro)</option>'+Object.keys(AGENT_NAMES).filter(x=>x!=='may-maestro').map(id=>'<option value="'+id+'">'+escapeHTML(label(id))+'</option>').join('');}
function requestForm(){
 return '<section class="panel request" aria-label="Nova solicitação"><div class="request-head"><h2>O que os agentes precisam fazer?</h2><span class="smallprint">Uma solicitação por vez</span></div>'+
 '<form id="task-form"><textarea id="objective" name="objective" placeholder="Ex.: Revisar o login do Ronda Pro, preservar a interface atual e verificar os testes..." required minlength="12" maxlength="2800">'+escapeHTML(draft)+'</textarea>'+
 '<div class="request-meta"><div class="field"><label for="project">Projeto</label><select id="project" name="project">'+projectOptions()+'</select></div>'+
 '<div class="field"><label for="priority">Prioridade</label><select id="priority" name="priority"><option value="P2">Normal</option><option value="P1">Alta</option><option value="P0">Urgente</option><option value="P3">Baixa</option></select></div>'+
 '<div class="field"><label for="agent">Responsável</label><select id="agent" name="agent">'+agentOptions()+'</select></div></div>'+
 '<div id="task-advanced" hidden class="request-meta">'+
 '<div class="field"><label for="repo">Repositório GitHub</label><input id="repo" name="repo" autocomplete="off" value="danielnep/app-hondas-maxvel"></div>'+
 '<div class="field"><label for="delivery">Tipo de projeto</label><select id="delivery" name="delivery"><option value="existing_product">Projeto existente</option><option value="new_product">Novo projeto</option></select></div>'+
 '<div class="field"><label for="paths">Arquivos permitidos, separados por vírgula</label><input id="paths" name="paths" placeholder="src/**, index.html"></div></div>'+
 '<div class="request-actions"><label class="checkbox"><input type="checkbox" id="public-confirm" required>Confirmo que a solicitação não contém segredos ou dados privados (fila pública no GitHub).</label>'+
 '<div class="actions-right"><button type="button" class="secondary" id="ai-action">Analisar com IA</button><button type="submit" class="primary" id="task-submit">Enviar solicitação ↑</button></div></div>'+
 '<button type="button" class="quiet" id="advanced-toggle" aria-expanded="false">Mostrar configuração da tarefa ▾</button>'+
 '<div id="ai-result" class="assist-result" hidden aria-live="polite"></div></form></section>';
}
function pageInicio(){
 return heading('Central de agentes','Solicite, acompanhe e intervenha sem abrir outra conversa.')+requestForm()+
 summary()+'<div class="section-heading"><h2>Em acompanhamento</h2><a class="linkrow" href="#tarefas">Ver todas →</a></div>'+
 listTasks(snapshot?.tasks||[],7)+(!snapshot?.available?.queue?'<p class="error">Fila do GitHub indisponível: não é possível confirmar que está vazia.</p>':'')+
 (snapshot?.issues?.length?'<div class="smallprint warning">'+snapshot.issues.map(escapeHTML).join(' • ')+'</div>':'');
}
function pageTarefas(){
 const tasks=snapshot?.tasks||[];const text=term.toLocaleLowerCase('pt-BR');
 const filtered=tasks.filter(t=>(filter==='todos'||t.status===filter)&&(!text||[t.project,t.id,t.title,t.agent].join(' ').toLocaleLowerCase('pt-BR').includes(text)));
 return heading('Tarefas','Solicitações registradas na fila e os respectivos resultados verificáveis.')+
 '<div class="searchbar"><input id="search" placeholder="Buscar por projeto ou tarefa…" aria-label="Buscar tarefas" value="'+escapeHTML(term)+'">'+
 '<select id="filter"><option value="todos">Todos os estados</option><option value="em execução">Em execução</option><option value="aguardando">Aguardando</option><option value="na fila">Na fila</option><option value="bloqueada">Bloqueada</option><option value="concluída">Concluída</option></select></div>'+
 '<div class="section-heading"><h2>'+filtered.length+' solicitações</h2><span class="meta">Fonte: fila e resultados do GitHub</span></div>'+listTasks(filtered);
}
function agentRow(a){
 return '<div class="agent-row"><div><div class="name">'+escapeHTML(label(a.id))+'</div><div class="details">'+escapeHTML(a.currentTask||'Nenhuma tarefa individual identificada')+'</div></div>'+
 chip(a.status)+'<button class="linkrow" data-agent="'+escapeHTML(a.id)+'">Ver agente →</button>'+
 (selectedAgent===a.id?'<div class="inline-detail">Agente: '+escapeHTML(a.id)+'\nEstado: '+escapeHTML(a.status)+'\nAtividade: '+escapeHTML(a.currentTask||'não verificada')+'\nÚltimo registro: '+escapeHTML(time(a.updatedAt))+'</div>':'')+'</div>';
}
function pageAgentes(){
 const a=snapshot?.agents||[];
 return heading('Os 17 especialistas','Estado individual apenas quando houver registro concreto de execução.')+
 '<div class="summary"><span><b>17</b> cadastrados</span><span>Atualização individual conforme registros disponíveis</span></div>'+
 '<div class="list">'+a.map(agentRow).join('')+'</div>';
}
function pageHistorico(){
 const events=snapshot?.events||[];
 return heading('Histórico de eventos','Registros recebidos por esta instância desde a última inicialização.')+
 (!events.length?'<div class="empty">Ainda não há eventos recentes da equipe nesta instância. O histórico técnico permanente fica no GitHub.</div>':
 '<div class="list">'+[...events].reverse().map(e=>
 '<div class="event-row"><time>'+escapeHTML(time(e.at))+'</time><div><strong>'+escapeHTML(e.kind==='worker'?'Worker: '+e.event:'Tarefa: '+e.event)+'</strong>'+
 '<p>'+escapeHTML(Object.entries(e).filter(([k])=>!['id','at','kind','event'].includes(k)).map(([k,v])=>k+': '+v).join(' • ')||'Evento recebido')+'</p></div></div>').join('')+'</div>')+
 '<p class="smallprint">Reiniciar o servidor limpa apenas este painel de eventos recentes, não os registros permanentes do executor.</p>';
}
function pageConsumo(){
 const u=snapshot?.usage||{};
 return heading('Consumo de tokens','Acompanhamento sem novas consultas à inteligência artificial.')+
 '<div class="stat-strip"><div><small>Tokens de entrada</small><strong>'+((u.input??null)===null?'—':u.input.toLocaleString('pt-BR'))+'</strong></div>'+
 '<div><small>Tokens de saída</small><strong>'+((u.output??null)===null?'—':u.output.toLocaleString('pt-BR'))+'</strong></div>'+
 '<div><small>Total identificado</small><strong>'+((u.total??null)===null?'—':u.total.toLocaleString('pt-BR'))+'</strong></div></div>'+
 '<p class="warning">O executor ainda não fornece contabilidade individual de tokens para esta central.</p>'+
 '<p class="smallprint">A Central não inventa consumo nem estima custo sem a resposta da API. A análise opcional com IA informa o consumo daquela solicitação quando o provedor o disponibilizar.</p>';
}
function pageSistema(){
 const w=snapshot?.worker||{status:'sem dados'};
 const last=w.lastCycle||{};
 return heading('Saúde do sistema','O que foi observado de verdade, sem confundir serviço online com agente trabalhando.')+
 '<section class="panel"><div class="section-heading"><h2>Execução Horizon</h2>'+chip(w.status)+'</div>'+
 '<div class="detail-grid">'+
 '<div><small>Serviço desta central</small><b>'+escapeHTML(online?'Conectado':'Sem confirmação de conexão')+'</b></div>'+
 '<div><small>Worker</small><b>'+escapeHTML(w.status||'não verificado')+'</b></div>'+
 '<div><small>Último ciclo visto</small><b>'+escapeHTML(time(last.at))+'</b></div>'+
 '<div><small>Resultado do último ciclo</small><b>'+escapeHTML(last.rc??last.code??'não informado')+'</b></div>'+
 '<div><small>Fonte de tarefas</small><b>'+escapeHTML(snapshot?.available?.queue?'GitHub consultado':'GitHub indisponível')+'</b></div>'+
 '<div><small>Presença dos agentes</small><b>'+escapeHTML(snapshot?.available?.attendance?'Registros consultados':'Sem confirmação individual')+'</b></div></div>'+
 '<p class="smallprint">Os erros completos do processo permanecem nos logs do Railway. Este painel não tem acesso direto à API administrativa do Railway.</p></section>'+
 '<div class="section-heading"><h2>Conexão</h2></div><div class="smallprint">Atualizações por SSE, com reconexão e atualização periódica de segurança. Nada de IA para sincronizar estados.</div>';
}
function render(){
 updateMenu();const page=active();const template={inicio:pageInicio,tarefas:pageTarefas,agentes:pageAgentes,historico:pageHistorico,consumo:pageConsumo,sistema:pageSistema}[page];
 const content=$('content');content.innerHTML=template();
 bind();updateConn();
}
function bind(){
 document.querySelectorAll('[data-detail]').forEach(el=>el.addEventListener('click',()=>{
 const target=document.getElementById('detail-'+el.dataset.detail);if(!target)return;
 target.hidden=!target.hidden;el.setAttribute('aria-expanded',String(!target.hidden));el.textContent=target.hidden?'Detalhes ▾':'Recolher ▴';
 }));
 document.querySelectorAll('[data-agent]').forEach(el=>el.addEventListener('click',()=>{selectedAgent=selectedAgent===el.dataset.agent?null:el.dataset.agent;render()}));
 const search=$('search');if(search)search.addEventListener('input',()=>{term=search.value;render();$('search')?.focus();$('search')?.setSelectionRange(term.length,term.length)});
 const dropdown=$('filter');if(dropdown){dropdown.value=filter;dropdown.addEventListener('change',()=>{filter=dropdown.value;render()});}
 const objective=$('objective');if(objective)objective.addEventListener('input',()=>draft=objective.value);
 const form=$('task-form');
 if(form){
 const project=$('project'),repo=$('repo'),delivery=$('delivery'),advanced=$('task-advanced'),toggle=$('advanced-toggle');
 const presets={'ronda-pro':'src/**','michelle-preview':'src/**','horizon-site':'index.html'};
 function applyProject(){
  if(project.value==='novo-projeto'){repo.value='danielnep/';delivery.value='new_product';$('paths').value='';advanced.hidden=false;toggle.setAttribute('aria-expanded','true');}
  else{repo.value=PROJECTS[project.value].repository;delivery.value='existing_product';$('paths').value=presets[project.value]||'';}}
 project.addEventListener('change',applyProject);applyProject();
 toggle.addEventListener('click',()=>{advanced.hidden=!advanced.hidden;toggle.setAttribute('aria-expanded',String(!advanced.hidden));toggle.textContent=advanced.hidden?'Mostrar configuração da tarefa ▾':'Ocultar configuração ▴';});
 $('ai-action').addEventListener('click',async()=>{const message=objective.value.trim();if(message.length<12){note('Descreva a solicitação antes de analisar.',true);return;}
 const b=$('ai-action');b.disabled=true;b.textContent='Analisando...';
 try{const r=await api('ai/interpret',{method:'POST',body:JSON.stringify({message})});const target=$('ai-result');target.hidden=false;target.textContent=r.response+(r.usage?.input!==null&&r.usage?.input!==undefined?'\n\nTokens desta análise: '+r.usage.input+' entrada, '+(r.usage.output??'não informado')+' saída.':'');}
 catch(e){note(e.message,true);}finally{b.disabled=false;b.textContent='Analisar com IA';}});
 form.addEventListener('submit',async e=>{e.preventDefault();const b=$('task-submit');if(b.disabled)return;
 const value={objective:objective.value.trim(),project:project.value==='novo-projeto'?'novo-projeto':project.value,repository:repo.value.trim(),priority:$('priority').value,agent:$('agent').value,
 delivery_type:delivery.value,allowed_paths:$('paths').value.split(',').map(s=>s.trim()).filter(Boolean),public_data_confirmed:$('public-confirm').checked};
 if(!value.repository.startsWith('danielnep/')||value.repository.length<13){advanced.hidden=false;note('Informe o repositório autorizado.',true);return;}
 if(value.delivery_type==='existing_product'&&value.allowed_paths.length===0){advanced.hidden=false;note('Para alterar um projeto existente, informe os caminhos permitidos.',true);return;}
 b.disabled=true;b.textContent='Enviando...';
 try{const saved=await api('tasks',{method:'POST',body:JSON.stringify(value)});draft='';note('Solicitação '+saved.id+' enviada. A execução ainda não foi comprovada.');await refresh(true);}
 catch(err){note(err.message,true);}finally{b.disabled=false;b.textContent='Enviar solicitação ↑';}
 });
 }
}
function updateConn(){
 const el=$('connection');el.className='connection '+(online?'ok':'off');
 el.querySelector('span').textContent=online?'Conectado':'Sem conexão';
}
async function refresh(force=false){
 if(refreshing)return refreshing;
 refreshing=(async()=>{
  try{const data=await api('overview');snapshot=data;online=true;
   const focused=document.activeElement;
   if(force||!focused||!['TEXTAREA','INPUT','SELECT'].includes(focused.tagName)||!$('task-form')?.contains(focused))render();
   else updateConn();
  }catch(e){online=false;updateConn();if(!snapshot)$('content').innerHTML='<div class="empty">Sem dados ao vivo: '+escapeHTML(e.message)+'. Verifique a sessão e tente novamente.</div>';}
 })().finally(()=>refreshing=null);
 return refreshing;
}
function connectEvents(){
 if(stream){stream.close();stream=null;}
 stream=new EventSource('/central/api/events');
 stream.addEventListener('update',()=>{setTimeout(()=>refresh(),450)});
 stream.onerror=()=>{if(!navigator.onLine){online=false;updateConn();}};
}
async function boot(){
 try{const s=await api('session');showLogin(!s.authenticated);
  if(s.authenticated){await refresh(true);connectEvents();}
  else if(!s.configured)$('login-error').textContent='Credencial administrativa não configurada no servidor.';
 }catch{showLogin(true);}
}
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();$('login-error').textContent='';
 try{await api('login',{method:'POST',body:JSON.stringify({password:$('password').value})});
 $('password').value='';showLogin(false);await refresh(true);connectEvents();
 }catch(e){$('login-error').textContent=e.message;}
});
$('refresh').addEventListener('click',()=>refresh(true));
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST'});}catch{}
 if(stream)stream.close();snapshot=null;showLogin(true);});
window.addEventListener('hashchange',render);
window.addEventListener('online',()=>refresh(true));
window.addEventListener('offline',()=>{online=false;updateConn()});
setInterval(()=>{if(!$('gate').hidden)return;refresh();},30000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/central/sw.js',{scope:'/central/'}).catch(()=>{}));
boot();