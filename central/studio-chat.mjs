const names={maestra:'Maestra',iris:'Íris',lume:'Lume',forja:'Forja',mosaico:'Mosaico',tatil:'Tátil',elo:'Elo',argos:'Argos'};
const roles={maestra:'Coordenação',iris:'Pesquisa e decisões',lume:'Design e experiência',forja:'Backend e dados',mosaico:'Web e PWA',tatil:'Android',elo:'Integrações',argos:'Testes e qualidade'};
const statuses={queued:'Na fila',running:'Consultando',completed:'Resposta recebida',failed:'Falhou',interrupted:'Interrompida',idle:'Sem consulta em andamento'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let root=null,timer=null,selected='horizon-studio',generation=0,authorized=false,roster=null,signature='',loading=null,pendingRequest=null;
let invite='';
if(location.hash.startsWith('#studio-access=')){
 invite=location.hash.slice('#studio-access='.length);
 history.replaceState(null,'',location.pathname+location.search+'#estudio');
}
try{selected=sessionStorage.getItem('horizon.studio.conversation-project')||selected}catch{}
const draftKey=project=>'horizon.studio.draft.'+project;
function saveDraft(){if(root)try{sessionStorage.setItem(draftKey(selected),root.querySelector('#studio-message').value)}catch{}}
function draft(){try{return sessionStorage.getItem(draftKey(selected))||''}catch{return ''}}
async function request(path,options={}){
 const response=await fetch('/central/api/studio/'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'content-type':'application/json',...options.headers}});
 const value=await response.json();
 if(!response.ok){const error=new Error(value.error||'Falha na conexão');error.status=response.status;throw error;}
 return value;
}
export function studioConversationMarkup(apps=[]){
 const projects=[{id:'horizon-studio',name:'Horizon Studio'},...apps];
 if(!projects.some(p=>p.id===selected))selected=projects[0].id;
 return '<div class="hz-conversation" id="studio-conversation">'+
 '<div class="hz-conversation-context"><label>Projeto<select id="studio-chat-project">'+projects.map(p=>'<option value="'+escape(p.id)+'"'+(p.id===selected?' selected':'')+'>'+escape(p.name||p.label)+'</option>').join('')+'</select></label>'+
 '<label>Conversar com<select id="studio-chat-agent">'+Object.entries(names).map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'</select></label></div>'+
 '<div class="hz-conversation-heading"><strong>Vamos construir a próxima ideia.</strong><p>Converse com a equipe sobre o projeto selecionado. As respostas e decisões ficam no histórico.</p></div>'+
 '<form id="studio-owner-form" class="hz-owner-form" hidden><label>Acesso do proprietário<input id="studio-owner-password" type="password" autocomplete="current-password" placeholder="Senha da Central"></label><button class="hz-action" type="submit">Desbloquear conversa</button><small>Abra o link de acesso do Studio para reconhecer este dispositivo sem digitar a senha.</small></form>'+
 '<div id="studio-chat-history" class="hz-conversation-history" role="log" aria-label="Histórico da conversa" aria-live="polite"><p class="hz-muted">Conectando ao Antigravity…</p></div>'+
 '<p id="studio-chat-feedback" class="hz-chat-feedback" role="status"></p>'+
 '<form id="studio-chat-form" class="hz-composer"><label class="hz-visually-hidden" for="studio-message">Mensagem para o agente selecionado</label><textarea id="studio-message" rows="3" maxlength="6000" placeholder="O que vamos pensar neste projeto?" required></textarea>'+
 '<div class="hz-composer-footer"><small>Consulta e planejamento · alterações nos apps ainda não são executadas aqui.</small><button class="hz-action" id="studio-message-send" type="submit" disabled>Enviar <span aria-hidden="true">↑</span></button></div></form></div>';
}
export function studioAgentsMarkup(){
 return '<div class="hz-roster-head"><strong>Equipe Antigravity</strong><span>8 especialidades</span></div>'+
 '<p class="hz-muted">'+(roster?'Atividade real das consultas deste Studio.':'Conecte seu acesso em Conversar para acompanhar as consultas.')+'</p>'+
 '<div class="hz-roster">'+Object.entries(names).map(([id,name])=>{
 const record=roster?.agents?.find(a=>a.id===id);
 const status=record?statuses[record.status]||record.status:'Sem conexão confirmada';
 return '<div class="hz-roster-row"><span class="hz-agent-symbol" aria-hidden="true">'+escape(name[0])+'</span><div><strong>'+escape(name)+'</strong><small>'+escape(roles[id])+'</small></div><span class="hz-roster-status'+(record?.status==='running'?' is-working':'')+'">'+escape(status)+(record?.queued?' · '+record.queued+' na fila':'')+'</span></div>';
 }).join('')+'</div><p class="hz-muted">Um agente disponível não significa que esteja trabalhando. Apps e consultas têm históricos separados.</p>';
}
function feedback(message,error=false){if(root){const el=root.querySelector('#studio-chat-feedback');el.textContent=message;el.classList.toggle('is-error',error)}}
function showAccess(){
 if(!root)return;
 root.querySelector('#studio-owner-form').hidden=authorized;
 root.querySelector('#studio-message-send').disabled=!authorized||pendingRequest!==null;
 if(!authorized){roster=null;const pane=document.getElementById('hz-pane-agents');if(pane)pane.innerHTML=studioAgentsMarkup();}
}
function paintMessages(messages){
 const history=root?.querySelector('#studio-chat-history');if(!history)return;
 const next=JSON.stringify(messages);
 if(next===signature)return;
 signature=next;
 const stick=history.scrollHeight-history.scrollTop-history.clientHeight<90;
 history.replaceChildren();
 if(!messages.length){const empty=document.createElement('p');empty.className='hz-chat-empty';empty.textContent='Seu histórico começa aqui. Escolha o agente e envie sua primeira mensagem.';history.append(empty);return;}
 for(const message of messages){
  const turn=document.createElement('article');turn.className='hz-chat-turn';
  const user=document.createElement('div');user.className='hz-chat-bubble hz-chat-user';
  const userLabel=document.createElement('strong');userLabel.textContent='Você';
  const userText=document.createElement('p');userText.textContent=message.prompt;
  user.append(userLabel,userText);turn.append(user);
  const reply=document.createElement('div');reply.className='hz-chat-bubble hz-chat-agent';
  const label=document.createElement('strong');label.textContent=names[message.actor]||message.actor;
  const text=document.createElement('p');text.innerHTML=escape(message.response||message.error||(message.status==='queued'?'Mensagem salva. Aguardando sua vez na fila…':'O agente está preparando a resposta…')).replace(/\*\*([^\n*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
  const status=document.createElement('small');status.textContent=statuses[message.status]||message.status;
  reply.append(label,text,status);
  if(['failed','interrupted'].includes(message.status)){
   const retry=document.createElement('button');retry.type='button';retry.className='studio-tool';retry.textContent='Tentar novamente';
   retry.addEventListener('click',()=>{root.querySelector('#studio-message').value=message.prompt;root.querySelector('#studio-chat-agent').value=message.actor;saveDraft();root.querySelector('#studio-message').focus();});
   reply.append(retry);
  }
  turn.append(reply);history.append(turn);
 }
 if(stick)history.scrollTop=history.scrollHeight;
}
async function refresh(){
 if(!root?.isConnected||!authorized||loading===generation)return;
 const current=root,project=selected,version=generation;loading=version;
 try{
  const [history,agents]=await Promise.all([request('projects/'+project+'/messages'),request('agents')]);
  if(root!==current||version!==generation)return;
  paintMessages(history.messages||[]);roster=agents;
  const pane=document.getElementById('hz-pane-agents');if(pane)pane.innerHTML=studioAgentsMarkup();
 }catch(e){
  if(root!==current||version!==generation)return;
  if(e.status===401){authorized=false;showAccess();}
  feedback(e.status===401?'Desbloqueie seu acesso para carregar as conversas.':'Não foi possível atualizar agora. O histórico salvo será recuperado na reconexão.',true);
 }finally{if(loading===version)loading=null;}
}
export function selectStudioConversation(project){
 if(!root||!root.querySelector('#studio-chat-project option[value="'+CSS.escape(project)+'"]')||project===selected)return;
 saveDraft();selected=project;generation++;signature='';
 try{sessionStorage.setItem('horizon.studio.conversation-project',selected)}catch{}
 root.querySelector('#studio-chat-project').value=selected;
 root.querySelector('#studio-message').value=draft();
 root.querySelector('#studio-chat-history').textContent='Carregando histórico…';
 feedback('');void refresh();
}
export function stopStudioConversation(){
 saveDraft();if(timer)clearInterval(timer);timer=null;root=null;generation++;signature='';loading=null;
}
export async function mountStudioConversation(){
 const target=document.getElementById('studio-conversation');if(!target||target===root)return;
 stopStudioConversation();root=target;
 root.querySelector('#studio-message').value=draft();
 root.querySelector('#studio-message').addEventListener('input',saveDraft);
 root.querySelector('#studio-chat-project').addEventListener('change',e=>{
  selectStudioConversation(e.target.value);
  const select=document.getElementById('studio-project');
  if(select&&[...select.options].some(o=>o.value===selected)&&select.value!==selected){select.value=selected;select.dispatchEvent(new Event('change'));}
 });
 root.querySelector('#studio-owner-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const input=root.querySelector('#studio-owner-password');
  try{await request('unlock',{method:'POST',body:JSON.stringify({password:input.value})});input.value='';authorized=true;showAccess();feedback('Acesso reconhecido neste dispositivo.');await refresh();}
  catch{feedback('Não foi possível desbloquear. Use a senha da Central ou o link de acesso do Studio.',true)}
 });
 root.querySelector('#studio-chat-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!authorized||pendingRequest)return;
  const input=root.querySelector('#studio-message'),message=input.value.trim();if(message.length<3){feedback('Escreva pelo menos 3 caracteres.',true);return;}
  const project=selected,actor=root.querySelector('#studio-chat-agent').value;
  // Reuse the idempotency key after a network failure for this exact payload.
  let pending;try{pending=JSON.parse(sessionStorage.getItem('horizon.studio.pending')||'null')}catch{}
  if(!pending||pending.project!==project||pending.message!==message||pending.actor!==actor)pending={project,message,actor,client_id:crypto.randomUUID()};
  try{sessionStorage.setItem('horizon.studio.pending',JSON.stringify(pending))}catch{}
  pendingRequest=pending;showAccess();feedback('Salvando mensagem…');
  try{
   await request('projects/'+project+'/messages',{method:'POST',body:JSON.stringify({message,actor,client_id:pending.client_id})});
   try{sessionStorage.removeItem('horizon.studio.pending');sessionStorage.removeItem(draftKey(project))}catch{}
   if(root&&selected===project){input.value='';feedback('Mensagem salva. Você pode trocar de aba enquanto o agente responde.');}
   await refresh();
  }catch(e){feedback(e.message,true);}
  finally{pendingRequest=null;showAccess();}
 });
 timer=setInterval(()=>void refresh(),2500);
 try{
  if(invite){const token=invite;invite='';await request('unlock',{method:'POST',body:JSON.stringify({invite:token})});}
  const session=await request('session');authorized=session.authenticated===true;showAccess();
  if(authorized){feedback('');await refresh();}
  else{root.querySelector('#studio-chat-history').replaceChildren();feedback('A conversa fica disponível apenas no seu dispositivo autorizado.');}
 }catch(e){authorized=false;showAccess();feedback('O acesso não pôde ser confirmado. Abra o link de acesso ou desbloqueie abaixo.',true);}
}
