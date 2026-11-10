import {studioMarkup,mountStudio,notifyStudioChanged} from './studio.mjs';
import {studioConversationMarkup,studioAgentsMarkup,mountStudioConversation,selectStudioConversation,setStudioConversationMode} from './studio-chat.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={preview:'m8 4 12 8-12 8V4Z',chat:'M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z',agents:'m12 3 10 6-10 6L2 9l10-6Zm-10 12 10 6 10-6M2 12l10 6 10-6',maestra:'M12 2c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10Z',phone:'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h2',arrow:'M7 17 17 7M7 7h10v10',bolt:'m13 2-9 12h7l-1 8 10-13h-7l1-7',check:'m7 12 3 3 7-7M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'};
export const studioIcon=(name)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.maestra)+'"/></svg>';
const labels={preview:'Prévia',chat:'Conversar',agents:'Agentes',maestra:'Maestra'};
export function studioShellMarkup(projects,tools=''){
 return '<div class="hs-shell" id="hz-studio-app" data-pane="preview">'+
 '<header class="hs-header"><a class="hs-brand" href="#estudio" aria-label="Horizon Studio"><img src="./studio-mark.svg" alt=""/><span>Horizon <em>Studio</em></span></a><label class="hs-project"><span class="hz-visually-hidden">Projeto do Studio</span>'+studioIcon('agents')+'<select id="hs-project">'+projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label></header>'+
 '<div class="hs-layout"><aside class="hs-projects" aria-label="Projetos"><div class="hs-sidebar-title">Seus projetos <span>'+projects.length+'</span></div>'+projects.map(p=>'<button class="hs-project-item" data-project="'+esc(p.id)+'">'+studioIcon('agents')+'<span><strong>'+esc(p.name)+'</strong><small>'+(p.url?'Publicado na VPS':'Publicação a verificar')+'</small></span></button>').join('')+'<a class="hs-central" href="#inicio">Central de operações '+studioIcon('arrow')+'</a></aside>'+
 '<div class="hs-workspace"><div class="hs-toolbar"><button type="button" class="hs-preview-pill" data-go="preview">'+studioIcon('preview')+'Prévia</button><label class="hs-device">'+studioIcon('phone')+'<span class="hz-visually-hidden">Tamanho da prévia</span><select id="hs-device"><option value="mobile">390 × 844</option><option value="tablet">768 × 1024</option><option value="desktop">1440 × 900</option></select></label><button type="button" class="hs-open-chat" data-go="chat">'+studioIcon('chat')+'<span>Abrir conversa</span></button></div>'+
 '<div class="hs-panels"><section id="hz-pane-preview" class="hs-pane hs-preview" role="tabpanel" aria-labelledby="hz-tab-preview">'+studioMarkup(projects)+'</section>'+
 '<section id="hz-pane-chat" class="hs-pane hs-chat" role="tabpanel" aria-labelledby="hz-tab-chat" hidden><header class="hs-pane-heading"><span class="hs-feature-icon">'+studioIcon('maestra')+'</span><div><h1 id="hs-chat-title">Conversar</h1><p id="hs-chat-description">Pense o projeto com a equipe.</p></div><details class="hs-more"><summary aria-label="Ferramentas do Studio">☰</summary><div><button type="button" id="hs-tools-open">Ferramentas de desenvolvimento</button><a href="#tarefas">Acompanhar tarefas</a><a href="#inicio">Central de operações</a></div></details></header>'+studioConversationMarkup(projects)+'</section>'+
 '<section id="hz-pane-agents" class="hs-pane hs-agents" role="tabpanel" aria-labelledby="hz-tab-agents" hidden><header class="hs-pane-heading"><span class="hs-feature-icon">'+studioIcon('agents')+'</span><div><h1>Agentes</h1><p>Acompanhe a atividade da equipe.</p></div></header><div id="hs-roster">'+studioAgentsMarkup()+'</div></section></div>'+
 '<footer class="hs-status" aria-live="polite"><span>'+studioIcon('agents')+'<span id="hs-agent-status">Conectando equipe</span></span><span>'+studioIcon('bolt')+'<span id="hs-queue-status">Consultando fila</span></span><span>'+studioIcon('check')+'<span id="hs-preview-status">Verificando prévia</span></span></footer>'+
 '<div class="hs-source"><span id="hs-project-source"></span><a id="hs-repository" target="_blank" rel="noopener noreferrer" hidden>GitHub '+studioIcon('arrow')+'</a></div></div></div>'+
 '<nav class="hs-tabs" role="tablist" aria-label="Área de trabalho do Studio">'+Object.entries(labels).map(([id,label])=>'<button type="button" role="tab" aria-controls="hz-pane-'+(id==='maestra'?'chat':id)+'" id="hz-tab-'+id+'" data-hz-tab="'+id+'" aria-selected="'+(id==='preview')+'">'+studioIcon(id)+'<span>'+label+'</span></button>').join('')+'</nav>'+
 '<dialog id="hs-tools" class="hs-tools"><header><h2>Ferramentas de desenvolvimento</h2><button type="button" id="hs-tools-close" aria-label="Fechar ferramentas">×</button></header>'+tools+'</dialog></div>';
}
export function mountStudioShell(projects){
 const shell=document.getElementById('hz-studio-app');if(!shell)return;
 const picker=shell.querySelector('#hs-project'),preview=shell.querySelector('#studio-project');
 const activate=value=>{
  if(!labels[value])value='preview';
  shell.dataset.pane=value;
  shell.querySelectorAll('[data-hz-tab]').forEach(tab=>{const chosen=tab.dataset.hzTab===value;tab.setAttribute('aria-selected',String(chosen));tab.tabIndex=chosen?0:-1;});
  for(const id of ['preview','chat','agents'])shell.querySelector('#hz-pane-'+id).hidden=id!==(value==='maestra'?'chat':value);
  shell.querySelector('#hz-pane-chat').setAttribute('aria-labelledby','hz-tab-'+(value==='maestra'?'maestra':'chat'));
  setStudioConversationMode(value==='maestra'?'maestra':'chat');
  shell.querySelector('#hs-chat-title').textContent=labels[value==='maestra'?'maestra':'chat'];
  shell.querySelector('#hs-chat-description').textContent=value==='maestra'?'Converse com a Maestra sem interromper o trabalho.':'Converse sobre ideias e próximos passos.';
  try{sessionStorage.setItem('horizon.studio.mobile-pane',value)}catch{}
  if(value==='preview')notifyStudioChanged();
  requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
 };
 shell.querySelectorAll('[data-hz-tab],[data-go]').forEach(button=>button.addEventListener('click',()=>activate(button.dataset.hzTab||button.dataset.go)));
 const tabs=[...shell.querySelectorAll('[data-hz-tab]')];
 tabs.forEach((tab,i)=>tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%4;if(e.key==='ArrowLeft')next=(i+3)%4;if(e.key==='Home')next=0;if(e.key==='End')next=3;if(next!==undefined){e.preventDefault();activate(tabs[next].dataset.hzTab);tabs[next].focus();}}));
 function choose(id){
  const project=projects.find(p=>p.id===id);if(!project)return;
  picker.value=id;
  if(preview.value!==id){preview.value=id;preview.dispatchEvent(new Event('change'));}
  selectStudioConversation(id);
  shell.querySelectorAll('[data-project]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.project===id)));
  const repo=shell.querySelector('#hs-repository');repo.hidden=!project.repository;
  if(project.repository)repo.href='https://github.com/'+project.repository;
  shell.querySelector('#hs-project-source').textContent=project.url?'VPS · '+new URL(project.url).hostname:'Publicação ainda não identificada';
  shell.querySelector('#project')?.querySelectorAll('option').forEach(o=>o.selected=o.value===project.repository);
  shell.dispatchEvent(new CustomEvent('studio-project-selected',{bubbles:true,detail:project}));
 }
 picker.addEventListener('change',()=>choose(picker.value));
 shell.querySelectorAll('[data-project]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.project)));
 shell.querySelector('#hs-device').addEventListener('change',e=>shell.querySelector('[data-device="'+e.target.value+'"]').click());
 shell.querySelector('#hs-tools-open').addEventListener('click',()=>shell.querySelector('#hs-tools').showModal());
 shell.querySelector('#hs-tools-close').addEventListener('click',()=>shell.querySelector('#hs-tools').close());
 void mountStudioConversation();
 mountStudio({repositories:projects,onProjectChange:choose});
 choose(preview.value||projects[0]?.id);
 const currentDevice=shell.querySelector('[data-device][aria-pressed="true"]');if(currentDevice)shell.querySelector('#hs-device').value=currentDevice.dataset.device;
 let pane='preview';try{pane=sessionStorage.getItem('horizon.studio.mobile-pane')||pane}catch{}activate(pane);
}
