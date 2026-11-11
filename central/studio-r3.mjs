/* Horizon Studio R3: one application, one mount, real VPS and Antigravity APIs. */
const $=id=>document.getElementById(id);
const agents=Object.freeze({maestra:'Maestra',iris:'Íris',lume:'Lume',forja:'Forja',mosaico:'Mosaico',tatil:'Tátil',elo:'Elo',argos:'Argos'});
const sizes=Object.freeze({mobile:[390,844],tablet:[768,1024],desktop:[1440,900]});
const state={apps:[],repos:[],current:'',actor:'maestra',device:'mobile',view:'preview',authorized:false,connecting:false,loadGeneration:0,chatLoading:false,chatSending:false,selectedFile:'',filePath:'',previewUrl:'',messagesSignature:'',chatTimer:null,qualityTimer:null};
try{state.current=sessionStorage.getItem('hz.r3.project')||'';state.actor=sessionStorage.getItem('hz.r3.agent')||'maestra';state.device=sessionStorage.getItem('hz.r3.device')||'mobile';}catch{}
if(!agents[state.actor])state.actor='maestra';if(!sizes[state.device])state.device='mobile';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(endpoint,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const result=await fetch('/central/api/'+endpoint,{credentials:'same-origin',cache:'no-store',...options,signal:options.signal||controller.signal,headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers}});
  let data;try{data=await result.json()}catch{data={error:'resposta_invalida'}}
  if(!result.ok){const error=new Error(String(data.error||data.message||'Falha na conexão'));error.status=result.status;throw error;}
  return data;
 }finally{clearTimeout(timeout)}
}
function text(node,value){node.textContent=String(value??'')}
function notify(message,kind='info'){const el=$('chat-feedback');text(el,message);el.dataset.kind=kind}
function setConnection(connected,message){$('connection-dot').className=connected?'connected':'offline';text($('connection-text'),message);$('connection-text').title=message}
function getDraft(){try{return sessionStorage.getItem('hz.r3.draft.'+state.current)||''}catch{return ''}}
function saveDraft(){try{sessionStorage.setItem('hz.r3.draft.'+state.current,$('prompt').value)}catch{}}
function updateSource(){
 const app=state.apps.find(x=>x.id===state.current);
 text($('editor-project'),app?.name||'Selecione um aplicativo');
 text($('project-source'),app?.url?'VPS publicada':app?.repository?'Somente código GitHub':'Sem publicação');
 text($('chat-context'),app?.name||'Nenhum projeto');
 text($('repo-status'),app?.repository||'Repositório não associado');
 const repoLink=$('repository-link');repoLink.hidden=!app?.repository;
 if(app?.repository)repoLink.href='https://github.com/'+app.repository;
}
function showProjectList(){
 const phrase=$('project-search').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const apps=state.apps.filter(app=>(app.name||app.id).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(phrase));
 for(const [node,arr] of [[$('vps-projects'),apps.filter(x=>Boolean(x.url))],[$('git-projects'),apps.filter(x=>!x.url)]]){
  node.replaceChildren();
  for(const project of arr){
   const button=document.createElement('button');button.type='button';button.className='project-item'+(project.id===state.current?' active':'');
   button.setAttribute('aria-current',String(project.id===state.current));
   const sym=document.createElement('span');sym.className='project-icon';sym.textContent=(project.name||project.id).slice(0,1).toUpperCase();
   const info=document.createElement('span');info.className='project-meta';
   const label=document.createElement('strong');label.textContent=project.name||project.id;
   const small=document.createElement('small');small.textContent=project.url?'Publicado na VPS':project.repository?'Código GitHub':'Sem repositório';
   info.append(label,small);button.append(sym,info);
   button.addEventListener('click',()=>selectProject(project.id));
   node.append(button);
  }
  if(!arr.length){const item=document.createElement('span');item.className='project-loading';item.textContent='Nenhum projeto nesta categoria';node.append(item);}
 }
 text($('project-count'),state.apps.length+' projetos');
 const selector=$('project-picker');selector.replaceChildren();
 for(const app of state.apps){const option=document.createElement('option');option.value=app.id;option.textContent=app.name||app.id;selector.append(option);}
 selector.value=state.current;
}
function setMobilePane(name){
 if(!['chat','projects','editor'].includes(name))return;
 $('studio').dataset.mobilePane=name;
 document.querySelectorAll('[data-pane]').forEach(button=>button.classList.toggle('selected',button.dataset.pane===name));
 if(name==='editor')requestAnimationFrame(fitFrame);
}
function selectProject(id){
 const app=state.apps.find(x=>x.id===id);if(!app)return;
 if(id===state.current){setMobilePane('chat');return;}
 const draft=$('prompt').value.trim();if(state.current&&draft)saveDraft();
 state.current=id;state.loadGeneration++;state.messagesSignature='';state.filePath='';state.selectedFile='';
 try{sessionStorage.setItem('hz.r3.project',id)}catch{}
 $('prompt').value=getDraft();$('messages').replaceChildren();
 $('chat-empty').hidden=false;
 notify('Projeto selecionado. Consultando contexto…');
 updateSource();showProjectList();showFilePlaceholder();void loadPreview();void loadMessages();void loadFiles();
 setMobilePane('chat');
}
async function loadProjects(){
 try{
  const values=await Promise.allSettled([request('studio/apps'),request('repositories'),request('studio/session')]);
  const catalog=values[0].status==='fulfilled'?values[0].value:{apps:[]};
  const list=Array.isArray(catalog.apps)?catalog.apps.filter(x=>x&&/^[a-z][a-z0-9-]+$/.test(x.id)):[];const seen=new Set();
  state.apps=list.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;});
  state.repos=values[1].status==='fulfilled'?(values[1].value.repositories||[]):[];
  state.authorized=values[2].status==='fulfilled'&&values[2].value.authenticated===true;
  if(!state.apps.length)throw Error('Nenhum projeto foi retornado pela VPS');
  if(!state.apps.some(x=>x.id===state.current))state.current=state.apps[0].id;
  text($('connection-text'),'VPS conectada');setConnection(true,'VPS conectada');
  $('prompt').value=getDraft();
  showProjectList();updateSource();renderAccess();
  await Promise.allSettled([loadPreview(),loadMessages(),loadFiles()]);
 }catch(error){
  setConnection(false,'VPS indisponível');
  text($('vps-projects'),'Falha ao consultar projetos. Use Atualizar.');
  text($('git-projects'),'');
  notify(error.message,'error');
  text($('preview-status'),'Conexão indisponível');
 }
}
function renderAccess(){
 $('send').disabled=!state.authorized;
 if(!state.authorized){$('messages').replaceChildren();$('chat-empty').hidden=false;notify('Conversa privada: abra pelo dispositivo já autorizado na entrada do Studio. O rascunho fica preservado.','error');}
 else notify('Conectado à equipe Antigravity. Envio não significa implementação iniciada.');
}
function renderAgents(){
 const target=$('agent-grid');target.replaceChildren();
 for(const [id,name] of Object.entries(agents)){
  const b=document.createElement('button');b.type='button';b.className='agent-pick';b.textContent=name;b.dataset.agent=id;b.setAttribute('aria-pressed',String(id===state.actor));
  b.addEventListener('click',()=>{state.actor=id;$('agent-picker').value=id;try{sessionStorage.setItem('hz.r3.agent',id)}catch{};renderAgents();$('agents-panel').hidden=true;$('agents-toggle').setAttribute('aria-expanded','false')});
  target.append(b);
 }
 $('agent-picker').value=state.actor;
}
function addBubble(owner,content,status){
 const item=document.createElement('article');item.className='message'+(owner==='Você'?' mine':'');
 const heading=document.createElement('div');heading.className='message-head';heading.textContent=owner;
 const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=String(content||'');
 item.append(heading,bubble);
 if(status){const badge=document.createElement('small');badge.className='message-status';badge.textContent=status;item.append(badge);}
 return item;
}
function drawMessages(messages){
 const signature=JSON.stringify(messages);
 if(signature===state.messagesSignature)return;
 state.messagesSignature=signature;
 const container=$('messages'),chat=$('chat-scroll'),wasAtBottom=(chat.scrollHeight-chat.scrollTop-chat.clientHeight)<100;
 container.replaceChildren();$('chat-empty').hidden=messages.length>0;
 for(const entry of messages){
  container.append(addBubble('Você',entry.prompt));
  const result=entry.response||entry.error||(entry.status==='queued'?'Mensagem recebida. Aguardando consulta.':entry.status==='running'?'Especialista preparando resposta…':'Resposta pendente.');
  container.append(addBubble(agents[entry.actor]||entry.actor||'Agente',result,entry.status==='failed'?'Falha registrada':entry.status==='running'?'Em consulta':entry.status==='queued'?'Na fila':''));
 }
 if(wasAtBottom)chat.scrollTop=chat.scrollHeight;
}
async function loadMessages(){
 if(!state.current||!state.authorized||state.chatLoading)return;
 state.chatLoading=true;const version=state.loadGeneration,id=state.current;
 try{
  const response=await request('studio/projects/'+encodeURIComponent(id)+'/messages');
  if(version!==state.loadGeneration)return;
  drawMessages(Array.isArray(response.messages)?response.messages:[]);
  if(response.messages?.length)notify('Histórico recuperado para '+(state.apps.find(x=>x.id===id)?.name||id)+'.');
 }catch(error){
  if(version!==state.loadGeneration)return;
  if(error.status===401){state.authorized=false;renderAccess();}
  else notify('Não foi possível carregar o histórico: '+error.message,'error');
 }finally{state.chatLoading=false;}
}
async function sendMessage(event){
 event.preventDefault();
 if(!state.authorized){renderAccess();return;}
 if(state.chatSending)return;const value=$('prompt').value.trim();
 if(value.length<3){notify('Escreva ao menos 3 caracteres.','error');return;}
 state.chatSending=true;$('send').disabled=true;notify('Salvando mensagem…');
 const id=state.current,actor=state.actor,clientId=crypto.randomUUID();
 try{
  await request('studio/projects/'+encodeURIComponent(id)+'/messages',{method:'POST',body:JSON.stringify({message:value,actor,client_id:clientId})});
  if(id===state.current && $('prompt').value.trim()===value){$('prompt').value='';saveDraft();}
  notify('Mensagem salva para consulta. Aguarde o registro da resposta.');
  await loadMessages();
 }catch(error){notify('Mensagem não enviada: '+error.message+'. Seu rascunho foi mantido.','error');}
 finally{state.chatSending=false;$('send').disabled=!state.authorized;}
}
async function submitImplementation(){
 const app=state.apps.find(x=>x.id===state.current),objective=$('prompt').value.trim();
 if(!app?.repository){notify('Este projeto ainda não possui repositório GitHub vinculado.','error');return;}
 if(objective.length<12){notify('Descreva a implementação em pelo menos 12 caracteres.','error');$('prompt').focus();return;}
 const button=$('implement');button.disabled=true;notify('Registrando solicitação na fila real…');
 try{
  const result=await request('tasks',{method:'POST',body:JSON.stringify({objective,repository:app.repository,project:app.repository.split('/')[1].toLowerCase(),priority:'P2',agent:state.actor,delivery_type:'existing_product',public_data_confirmed:true})});
  notify('Solicitação '+(result.id||'registrada')+' enviada. Aguarde execução e evidências; o registro não confirma entrega.');
 }catch(error){notify('Não foi possível registrar a implementação: '+error.message,'error');}
 finally{button.disabled=false;}
}
function isSafeUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&/^[a-z0-9-]+\.hzsys\.tech$/.test(u.hostname)&&(!u.port||u.port==='443')?u.href:null}catch{return null}
}
function emptyFrame(message){
 state.previewUrl='';const iframe=$('preview-frame');iframe.hidden=true;iframe.removeAttribute('src');$('frame-empty').hidden=false;
 text($('frame-empty').querySelector('p'),message||'Nenhuma publicação associada à VPS.');
 $('external-open').hidden=true;
}
async function loadPreview(){
 const app=state.apps.find(x=>x.id===state.current);
 if(!app){emptyFrame('Selecione um projeto.');return;}
 if(!app.url){emptyFrame('Código presente no GitHub, mas não há publicação verificada na VPS.');text($('preview-status'),'Sem publicação');return;}
 const version=state.loadGeneration; text($('preview-status'),'Verificando a publicação da VPS…');
 try{
  const data=await request('studio/preview?appId='+encodeURIComponent(app.id));
  if(version!==state.loadGeneration)return;
  const safe=data.ready?isSafeUrl(data.url):null;
  if(!safe){emptyFrame(data.message||'Aplicativo indisponível no momento.');text($('preview-status'),'Publicação indisponível');return;}
  const iframe=$('preview-frame');state.previewUrl=safe;
  iframe.hidden=false;$('frame-empty').hidden=true;
  iframe.src=safe;
  $('external-open').hidden=false;$('external-open').href=safe;
  text($('preview-status'),data.httpStatus===200?'Publicado na VPS':'Publicação protegida pela aplicação');
  fitFrame();
 }catch(error){if(version!==state.loadGeneration)return;emptyFrame('Não foi possível consultar a publicação.');text($('preview-status'),'Falha de comunicação');}
}
function fitFrame(){
 const spec=sizes[state.device],canvas=$('canvas'),stage=$('frame-stage');
 if(!canvas?.clientWidth)return;
 const width=Math.max(140,canvas.clientWidth-28),scale=Math.min(1,width/spec[0]);
 stage.style.width=Math.round(spec[0]*scale)+'px';stage.style.height=Math.round(spec[1]*scale)+'px';
 const frame=$('preview-frame');frame.style.width=spec[0]+'px';frame.style.height=spec[1]+'px';
 frame.style.transform='scale('+scale+')';frame.style.transformOrigin='top left';
 text($('dimensions'),spec[0]+' × '+spec[1]);
}
function setDevice(name){
 if(!sizes[name])return;state.device=name;
 try{sessionStorage.setItem('hz.r3.device',name)}catch{}
 document.querySelectorAll('[data-device]').forEach(button=>{const active=button.dataset.device===name;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 fitFrame();
}
function showFilePlaceholder(){
 text($('file-tree'),'Selecione a aba Código para consultar os arquivos.');
 text($('code-name'),'Nenhum arquivo aberto');
 text($('code-content'),'Escolha um arquivo na lateral para visualizar o código.');
}
async function loadFiles(path=''){
 const app=state.apps.find(x=>x.id===state.current);
 if(!app?.repository){text($('file-tree'),'Nenhum repositório vinculado a este projeto.');return;}
 const version=state.loadGeneration;state.filePath=path;
 text($('file-tree'),'Carregando arquivos…');
 try{
  const data=await request('studio/files?repository='+encodeURIComponent(app.repository)+'&path='+encodeURIComponent(path));
  if(version!==state.loadGeneration)return;
  const tree=$('file-tree');tree.replaceChildren();
  if(path){const back=document.createElement('button');back.className='file-entry';back.textContent='← Voltar';back.addEventListener('click',()=>loadFiles(path.split('/').slice(0,-1).join('/')));tree.append(back);}
  for(const file of data.items||[]){
   const button=document.createElement('button');button.type='button';button.className='file-entry';
   button.textContent=(file.type==='dir'?'▸ ':'  ')+file.name;
   button.title=file.path;
   button.addEventListener('click',()=>file.type==='dir'?loadFiles(file.path):loadFile(file.path));
   tree.append(button);
  }
  if(!(data.items||[]).length)text(tree,'Pasta vazia.');
 }catch(error){if(version!==state.loadGeneration)return;text($('file-tree'),'Arquivos indisponíveis: '+error.message);}
}
async function loadFile(path){
 const app=state.apps.find(x=>x.id===state.current);if(!app?.repository)return;
 const version=state.loadGeneration;state.selectedFile=path;
 text($('code-name'),path);text($('code-content'),'Lendo arquivo…');
 try{
  const data=await request('studio/file?repository='+encodeURIComponent(app.repository)+'&path='+encodeURIComponent(path));
  if(version!==state.loadGeneration||path!==state.selectedFile)return;
  text($('code-content'),data.content||'Arquivo vazio.');
  document.querySelectorAll('.file-entry').forEach(x=>x.classList.toggle('active',x.title===path));
 }catch(error){text($('code-content'),'Não foi possível carregar o arquivo: '+error.message);}
}
async function loadQuality(){
 const app=state.apps.find(x=>x.id===state.current),target=$('quality-content');
 if(!app)return;
 text(target,'Consultando registros reais…');
 try{
  const result=await request('overview');const all=Array.isArray(result.tasks)?result.tasks:[];
  const tasks=all.filter(t=>t.repository===app.repository||t.project===app.id).slice(0,12);
  target.replaceChildren();
  if(result.worker?.status&&/parad|inativ|offline|erro/i.test(result.worker.status)){
   const item=document.createElement('p');item.className='quality-notice';item.textContent='Executor de tarefas: '+result.worker.status+'. Uma tarefa na fila não significa execução.';target.append(item);
  }
  if(!tasks.length){const p=document.createElement('p');p.className='quality-notice';p.textContent='Nenhuma execução vinculada a este projeto foi encontrada na fila consultada.';target.append(p);}
  for(const task of tasks){
   const el=document.createElement('div');el.className='quality-item';const title=document.createElement('strong');title.textContent=task.title||task.objective||task.id||'Solicitação';
   const badge=document.createElement('span');badge.className='quality-state';badge.textContent=task.status||'Status não informado';
   const info=document.createElement('small');info.textContent=(task.id||'')+(task.agent?' · '+task.agent:'');
   el.append(title,badge,info);target.append(el);
  }
 }catch(error){text(target,'Verificações indisponíveis: '+error.message);}
}
function setView(name){
 if(!['preview','code','quality'].includes(name))return;
 state.view=name;
 document.querySelectorAll('[data-view]').forEach(tab=>{const active=tab.dataset.view===name;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
 for(const view of ['preview','code','quality'])$(view+'-view').hidden=view!==name;
 if(name==='preview')requestAnimationFrame(fitFrame);
 if(name==='code')void loadFiles();
 if(name==='quality')void loadQuality();
}
function attach(){
 $('refresh').addEventListener('click',()=>void loadProjects());
 $('project-picker').addEventListener('change',event=>selectProject(event.target.value));
 $('project-search').addEventListener('input',showProjectList);
 $('chat-form').addEventListener('submit',sendMessage);
 $('prompt').addEventListener('input',saveDraft);
 $('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('chat-form').requestSubmit();}});
 $('implement').addEventListener('click',()=>void submitImplementation());
 $('agent-picker').addEventListener('change',event=>{state.actor=event.target.value;try{sessionStorage.setItem('hz.r3.agent',state.actor)}catch{}renderAgents();});
 $('agents-toggle').addEventListener('click',()=>{const active=$('agents-panel').hidden;$('agents-panel').hidden=!active;$('agents-toggle').setAttribute('aria-expanded',String(active));});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('agents-panel').hidden=true;$('agents-toggle').setAttribute('aria-expanded','false');}});
 document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
 document.querySelectorAll('[data-device]').forEach(button=>button.addEventListener('click',()=>setDevice(button.dataset.device)));
 document.querySelectorAll('[data-pane]').forEach(button=>button.addEventListener('click',()=>setMobilePane(button.dataset.pane)));
 document.querySelectorAll('[data-suggestion]').forEach(button=>button.addEventListener('click',()=>{$('prompt').value=button.dataset.suggestion;saveDraft();$('prompt').focus();}));
 $('files-refresh').addEventListener('click',()=>void loadFiles(state.filePath));
 $('quality-refresh').addEventListener('click',()=>void loadQuality());
 new ResizeObserver(fitFrame).observe($('canvas'));
 window.addEventListener('online',()=>void loadProjects());
 window.addEventListener('offline',()=>setConnection(false,'Sem conexão'));
 window.addEventListener('hashchange',()=>{if(location.hash==='#estudio'||location.hash==='#inicio')history.replaceState(null,'',location.pathname+location.search);});
 renderAgents();setDevice(state.device);setView('preview');
}
async function boot(){
 // Old clients must not keep the obsolete Central as the registered PWA shell.
 if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.filter(r=>r.scope.includes('/central/')).map(r=>r.unregister()))).catch(()=>{});}
 if(location.hash.startsWith('#studio-access=')){
  const invitation=location.hash.slice('#studio-access='.length);
  history.replaceState(null,'',location.pathname+location.search);
  if(invitation){try{await request('studio/unlock',{method:'POST',body:JSON.stringify({invite:invitation})})}catch{}}
 }else if(location.hash==='#estudio'||location.hash==='#inicio'){
  history.replaceState(null,'',location.pathname+location.search);
 }
 attach();await loadProjects();
 state.chatTimer=setInterval(()=>{if(state.authorized&&!document.hidden)void loadMessages();},9000);
}
void boot();
