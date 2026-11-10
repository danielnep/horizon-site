const names={maestra:'Maestra',iris:'Íris',lume:'Lume',forja:'Forja',mosaico:'Mosaico',tatil:'Tátil',elo:'Elo',argos:'Argos'};
const agentPaths={maestra:'M12 2c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10Z',iris:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',lume:'M12 2c3 6-3 7 2 11 1-2 3-3 3-5 7 8 3 14-5 14S1 15 7 9c-1 5 2 5 2 2 0-4 3-6 3-9',forja:'m3 21 12-12M12 4l4-2 6 6-4 4-6-8Z',mosaico:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',tatil:'M9 13V4a2 2 0 0 1 4 0v7l5 2v6l-3 3H9l-6-7 2-2 4 3',elo:'m9 15 6-6M8 17l-2 2a4 4 0 0 1-6-6l6-6M16 7l2-2a4 4 0 0 1 6 6l-6 6',argos:'m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6l9-4Z'};
const agentIcon=id=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+agentPaths[id]+'"/></svg>';
const roles={maestra:'Coordenação',iris:'Pesquisa e decisões',lume:'Design e experiência',forja:'Backend e dados',mosaico:'Web e PWA',tatil:'Android',elo:'Integrações',argos:'Testes e qualidade'};
const statuses={queued:'Na fila',running:'Consultando',completed:'Concluída',failed:'Falhou',interrupted:'Interrompida',idle:'Disponível'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let root=null,timer=null,selected='horizon-studio',generation=0,authorized=false,roster=null,signature='',loading=null,pendingRequest=null;
let invite='',conversationMode='chat',selectedActor='maestra';
if(location.hash.startsWith('#studio-access=')){
 invite=location.hash.slice('#studio-access='.length);
 history.replaceState(null,'',location.pathname+location.search+'#estudio');
}
try{selected=sessionStorage.getItem('horizon.studio.conversation-project')||selected}catch{}
const draftKey=project=>'horizon.studio.draft.'+project;
function saveDraft(){if(root)try{sessionStorage.setItem(draftKey(selected)+'.'+conversationMode,root.querySelector('#studio-message').value)}catch{}}
function draft(){try{return sessionStorage.getItem(draftKey(selected)+'.'+conversationMode)||sessionStorage.getItem(draftKey(selected))||''}catch{return ''}}
async function request(path,options={}){
 const response=await fetch('/central/api/studio/'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'content-type':'application/json',...options.headers}});
 const value=await response.json();
 if(!response.ok){const error=new Error(value.error||'Falha na conexão');error.status=response.status;throw error;}
 return value;
}
export function studioConversationMarkup(apps=[]){
 const projects=apps.length?apps:[{id:'horizon-studio',name:'Horizon Studio'}];
 if(!projects.some(p=>p.id===selected))selected=projects[0].id;
 return '<div class="hz-conversation" id="studio-conversation">'+
 '<div class="hz-conversation-context"><label>Projeto<select id="studio-chat-project">'+projects.map(p=>'<option value="'+escape(p.id)+'"'+(p.id===selected?' selected':'')+'>'+escape(p.name||p.label)+'</option>').join('')+'</select></label>'+
 '<label>Conversar com<select id="studio-chat-agent">'+Object.entries(names).map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'</select></label></div>'+
 '<div class="hz-conversation-heading"><strong>Vamos construir a próxima ideia.</strong><p>Converse com a equipe sobre o projeto selecionado. As respostas e decisões ficam no histórico.</p></div>'+
 '<div id="studio-chat-history" class="hz-conversation-history" role="log" aria-label="Histórico da conversa" aria-live="polite"><p class="hz-muted">Conectando ao Antigravity…</p></div>'+
 '<p id="studio-chat-feedback" class="hz-chat-feedback" role="status"></p>'+
 '<form id="studio-chat-form" class="hz-composer"><label class="hz-visually-hidden" for="studio-message">Mensagem para o agente selecionado</label><textarea id="studio-message" rows="3" maxlength="6000" placeholder="O que vamos pensar neste projeto?" required></textarea>'+
 '<div class="hz-composer-footer"><small>Consulta e planejamento · alterações nos apps ainda não são executadas aqui.</small><button class="hz-action" id="studio-message-send" type="submit" disabled>Enviar <span aria-hidden="true">↑</span></button></div></form></div>';
}
export function studioAgentsMarkup(){
 return '<div class="hz-roster-head"><strong>8 especialistas</strong><span>'+ (roster?.agents?.filter(a=>a.status==='running').length??'—') +' em consulta</span></div>'+
 '<p class="hz-muted">'+(roster?'Atividade das conversas do Studio.':'A atividade será exibida ao confirmar sua sessão.')+'</p>'+
 '<div class="hz-roster">'+Object.entries(names).map(([id,name])=>{
 const record=roster?.agents?.find(a=>a.id===id);
 const status=record?statuses[record.status]||record.status:'Sem conexão';
 return '<div class="hz-roster-row"><span class="hz-agent-symbol" aria-hidden="true">'+agentIcon(id)+'</span><div><strong>'+escape(name)+'</strong><small>'+escape(roles[id])+'</small></div><span class="hz-roster-status'+(record?.status==='running'?' is-working':'')+'">'+escape(status)+(record?.queued?' · '+record.queued+' na fila':'')+'</span></div>';
 }).join('')+'</div><p class="hz-muted">As consultas e o desenvolvimento dos aplicativos têm filas independentes.</p>';
}
function feedback(message,error=false){if(root){const el=root.querySelector('#studio-chat-feedback');el.textContent=message;el.classList.toggle('is-error',error)}}
function showAccess(){
 if(!root)return;
 root.querySelector('#studio-message-send').disabled=!authorized||pendingRequest!==null;
 if(!authorized){const status=document.getElementById('hs-agent-status');if(status)status.textContent='Sessão necessária';const queue=document.getElementById('hs-queue-status');if(queue)queue.textContent='Não consultada';roster=null;const pane=document.getElementById('hs-roster');if(pane)pane.innerHTML=studioAgentsMarkup();}
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
  const status=document.createElement('small');const date=new Date(message.finished_at||message.created_at||'');status.textContent=(Number.isNaN(date.getTime())?'':date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' · ')+(statuses[message.status]||message.status);
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
  paintMessages(conversationMode==='maestra'?(history.messages||[]).filter(m=>m.actor==='maestra'):history.messages||[]);roster=agents;
  const active=agents.agents?.filter(a=>a.status==='running').length||0;
  const queued=agents.agents?.reduce((n,a)=>n+(a.queued||0),0)||0;
  const status=document.getElementById('hs-agent-status');if(status)status.textContent=active+' em consulta';
  const queue=document.getElementById('hs-queue-status');if(queue)queue.textContent=queued?queued+' na fila':'Fila livre';
  const pane=document.getElementById('hs-roster');if(pane)pane.innerHTML=studioAgentsMarkup();
 }catch(e){
  if(root!==current||version!==generation)return;
  if(e.status===401){authorized=false;showAccess();}
  feedback(e.status===401?'A sessão deste dispositivo expirou. Seu rascunho foi preservado.':'Não foi possível atualizar agora. O histórico salvo será recuperado na reconexão.',true);
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
 root.querySelector('#studio-chat-agent').addEventListener('change',e=>{selectedActor=e.target.value;});
 root.querySelector('#studio-chat-project').addEventListener('change',e=>{
  selectStudioConversation(e.target.value);
  const select=document.getElementById('studio-project');
  if(select&&[...select.options].some(o=>o.value===selected)&&select.value!==selected){select.value=selected;select.dispatchEvent(new Event('change'));}
 });
 root.querySelector('#studio-chat-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!authorized||pendingRequest)return;
  const input=root.querySelector('#studio-message'),message=input.value.trim();if(message.length<3){feedback('Escreva pelo menos 3 caracteres.',true);return;}
  const project=selected,mode=conversationMode,actor=root.querySelector('#studio-chat-agent').value;
  // Reuse the idempotency key after a network failure for this exact payload.
  let pending;try{pending=JSON.parse(sessionStorage.getItem('horizon.studio.pending')||'null')}catch{}
  if(!pending||pending.project!==project||pending.message!==message||pending.actor!==actor)pending={project,message,actor,client_id:crypto.randomUUID()};
  try{sessionStorage.setItem('horizon.studio.pending',JSON.stringify(pending))}catch{}
  pendingRequest=pending;showAccess();feedback('Salvando mensagem…');
  try{
   await request('projects/'+project+'/messages',{method:'POST',body:JSON.stringify({message,actor,client_id:pending.client_id})});
   try{sessionStorage.removeItem('horizon.studio.pending');sessionStorage.removeItem(draftKey(project)+'.'+mode);sessionStorage.removeItem(draftKey(project))}catch{}
   if(root&&selected===project&&conversationMode===mode){input.value='';feedback('Mensagem salva. Você pode trocar de aba enquanto o agente responde.');}
   await refresh();
  }catch(e){feedback(e.message,true);}
  finally{pendingRequest=null;showAccess();}
 });
 timer=setInterval(()=>void refresh(),2500);
 try{
  if(invite){const token=invite;invite='';await request('unlock',{method:'POST',body:JSON.stringify({invite:token})});}
  const session=await request('session');authorized=session.authenticated===true;showAccess();
  if(authorized){feedback('');await refresh();}
  else{root.querySelector('#studio-chat-history').replaceChildren();feedback('Abra no dispositivo autorizado para recuperar suas conversas.');}
 }catch(e){authorized=false;showAccess();feedback('Não foi possível confirmar a sessão deste dispositivo. Seu rascunho foi preservado.',true);}
}

export function setStudioConversationMode(mode){
 if(!root)return;
 if(mode!==conversationMode){saveDraft();conversationMode=mode;generation++;signature='';root.querySelector('#studio-message').value=draft();root.querySelector('#studio-chat-history').textContent='Carregando histórico…';void refresh();}
 const agent=root.querySelector('#studio-chat-agent');
 agent.value=mode==='maestra'?'maestra':selectedActor;
 root.querySelector('#studio-message').placeholder=mode==='maestra'?'Falar com a Maestra…':'Escreva uma ideia ou pergunta…';
 root.querySelector('#studio-message-send').setAttribute('aria-label',mode==='maestra'?'Enviar para Maestra':'Enviar mensagem');
}
