// Estúdio Horizon: preview do build REAL, com escopo restrito ao projeto selecionado.
const SIZES=Object.freeze({mobile:{width:390,height:844,label:'Mobile'},tablet:{width:768,height:1024,label:'Tablet'},desktop:{width:1440,height:900,label:'Desktop'}});
const STORE='horizon.studio.preview.v1';
const $=(root,id)=>root.querySelector('#'+id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const previous=(()=>{try{return JSON.parse(sessionStorage.getItem(STORE)||'{}')}catch{return {}}})();
const state={device:SIZES[previous.device]?previous.device:'mobile',project:previous.project||'',manualUrls:previous.manualUrls||{},lastRevision:'',currentUrl:'',source:'',checking:false,wantedReload:false,lastCheck:0,loop:null,observer:null,root:null,disposed:false};
function persist(){try{sessionStorage.setItem(STORE,JSON.stringify({device:state.device,project:state.project,manualUrls:state.manualUrls}))}catch{}}
function validPreview(raw){
 try{
  const u=new URL(String(raw||'').trim());
  if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  const host=u.hostname.toLowerCase();
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host==='0.0.0.0'||host==='127.0.0.1'||host==='[::1]'||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
  if(u.origin===location.origin)return null;
  u.hash='';return u.href;
 }catch{return null}
}
function setStatus(message,kind='pending'){
 const root=state.root;if(!root)return;
 const el=$(root,'studio-status');if(!el)return;
 el.textContent=message;el.dataset.kind=kind;
}
function setDevice(name){
 if(!SIZES[name])return;
 state.device=name;persist();
 const root=state.root;if(!root)return;
 root.querySelectorAll('[data-device]').forEach(b=>{
  const selected=b.dataset.device===name;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));
 });
 $(root,'studio-dimensions').textContent=SIZES[name].width+' × '+SIZES[name].height;
 fitPreview();
}
function fitPreview(){
 const root=state.root;if(!root)return;
 const wrap=$(root,'studio-canvas'),viewport=$(root,'studio-viewport');if(!wrap||!viewport)return;
 const spec=SIZES[state.device],padding=24;
 const available=Math.max(240,wrap.clientWidth-padding);
 const scale=Math.min(1,available/spec.width);
 viewport.style.width=spec.width+'px';
 viewport.style.height=spec.height+'px';
 viewport.style.transform='scale('+scale+')';
 $(root,'studio-stage').style.width=(spec.width*scale)+'px';
 $(root,'studio-stage').style.height=(spec.height*scale)+'px';
}
function display(url,revision=''){
 const root=state.root;if(!root)return;
 const frame=$(root,'studio-frame'),blank=$(root,'studio-blank');
 if(!url){
  state.currentUrl='';state.lastRevision='';frame.removeAttribute('src');
  frame.hidden=true;blank.hidden=false;$(root,'studio-open').disabled=true;
  fitPreview();return;
 }
 const changed=state.currentUrl!==url||state.lastRevision!==revision;
 state.currentUrl=url;state.lastRevision=revision;
 frame.hidden=false;blank.hidden=true;$(root,'studio-open').disabled=false;
 $(root,'studio-open').href=url;
 if(changed){
  setStatus('Carregando o aplicativo…');
  const target=new URL(url);
  if(revision)target.searchParams.set('_hz_preview',revision.slice(0,36));
  frame.src=target.href;
 }
 fitPreview();
}
async function probe({force=false}={}){
 const root=state.root;if(!root||!root.isConnected||state.disposed)return;
 if(state.checking){if(force)state.wantedReload=true;return;}
 if(!force&&Date.now()-state.lastCheck<14000)return;
 state.lastCheck=Date.now();state.checking=true;
 const project=state.project;
 const saved=validPreview(state.manualUrls[project]||'');
 const checkButton=$(root,'studio-check');checkButton.disabled=true;
 try{
  if(saved){
   state.source='custom';
   display(saved);
   setStatus('Endereço personalizado · recarregue para ver novas alterações','ready');
   return;
  }
  state.source='verified';setStatus('Procurando publicação deste projeto…');
  const response=await fetch('/central/api/preview?repository='+encodeURIComponent(project),{cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(project!==state.project||state.disposed)return;
  if(!response.ok||!data.ready||!validPreview(data.url)){
   display('');setStatus(data.message||'Este projeto ainda não tem uma publicação acessível','empty');
   return;
  }
  display(data.url,data.revision||'');
  setStatus(data.revision?'Preview publicado · atualização automática ativa':'Preview publicado · verificando alterações','ready');
 }catch{
  if(project===state.project){display('');setStatus('Não foi possível consultar a publicação. Use um endereço de preview direto.','error');}
 }finally{state.checking=false;if(state.root===root)checkButton.disabled=false;
  if(state.wantedReload&&!state.disposed){state.wantedReload=false;queueMicrotask(()=>void probe({force:true}));}}
}
function chooseProject(value){
 if(!value||value===state.project)return;
 state.project=value;state.currentUrl='';state.lastRevision='';persist();
 const root=state.root;
 $(root,'studio-url').value=state.manualUrls[value]||'';
 display('');void probe({force:true});
}
function setManual(value){
 const url=validPreview(value);
 if(value.trim()&&!url){setStatus('Informe um endereço HTTPS público, diferente do endereço da Central.','error');return}
 if(url)state.manualUrls[state.project]=url;else delete state.manualUrls[state.project];
 state.currentUrl='';state.lastRevision='';persist();void probe({force:true});
}
export function studioMarkup(repositories=[]){
 const available=repositories.filter(r=>r&&/^danielnep\/[A-Za-z0-9._-]+$/.test(r.repository));
 if(!available.some(r=>r.repository===state.project))state.project=available[0]?.repository||'';
 const options=available.map(r=>'<option value="'+safe(r.repository)+'"'+(state.project===r.repository?' selected':'')+'>'+safe(r.label||r.name||r.repository)+'</option>').join('');
 return '<section id="studio-root" class="studio-preview" aria-label="Preview interativo">'+
  '<div class="studio-toolbar"><div class="studio-caption"><span class="studio-indicator" aria-hidden="true"></span><strong>Preview ao vivo</strong><small id="studio-status" role="status" aria-live="polite">Verificando publicação…</small></div>'+
  '<div class="studio-controls" role="group" aria-label="Formato da tela">'+Object.keys(SIZES).map(k=>'<button type="button" class="studio-device'+(state.device===k?' selected':'')+'" data-device="'+k+'" aria-pressed="'+(state.device===k)+'">'+SIZES[k].label+'</button>').join('')+'</div></div>'+
  '<div class="studio-project-row"><label for="studio-project">Projeto</label><select id="studio-project"'+(available.length?'':' disabled')+'>'+options+'</select><button type="button" id="studio-check" class="studio-tool" title="Verificar nova publicação">↻ <span>Atualizar</span></button></div>'+
  '<div class="studio-canvas" id="studio-canvas"><div id="studio-stage" class="studio-stage"><div id="studio-viewport" class="studio-viewport"><iframe id="studio-frame" title="Aplicativo em desenvolvimento" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerpolicy="no-referrer" hidden></iframe>'+
  '<div id="studio-blank" class="studio-blank"><span class="studio-empty-icon" aria-hidden="true">▣</span><strong>Seu aplicativo aparece aqui</strong><p>Selecione um projeto publicado ou conecte o endereço do ambiente de desenvolvimento.</p></div></div></div></div>'+
  '<div class="studio-footer"><span id="studio-dimensions">'+SIZES[state.device].width+' × '+SIZES[state.device].height+'</span><span class="studio-footer-actions"><a id="studio-open" class="studio-tool" href="#" target="_blank" rel="noopener noreferrer" aria-label="Abrir aplicação em outra guia">↗ Abrir</a><button type="button" class="studio-tool" id="studio-full" aria-pressed="false">⛶ Ampliar</button></span></div>'+
  '<details class="studio-source"><summary>Conectar endereço do preview</summary><div class="studio-source-form"><label for="studio-url">URL HTTPS do app ou servidor de desenvolvimento</label><input id="studio-url" type="url" inputmode="url" placeholder="https://meu-projeto.exemplo.com/" autocomplete="url"><button id="studio-connect" type="button" class="secondary">Conectar</button><button id="studio-clear" type="button" class="quiet">Usar publicação detectada</button></div><p class="smallprint">O preview mostra a aplicação real. Se o servidor bloquear incorporação, abra o endereço em outra guia. Alterações locais ainda não publicadas precisam de um servidor de preview.</p></details>'+
  '</section>';
}
export function mountStudio({repositories=[],onProjectChange=()=>{}}={}){
 const root=document.getElementById('studio-root');
 if(!root)return;
 if(state.root===root)return;
 stopStudio();
 state.root=root;state.disposed=false;
 const select=$(root,'studio-project');
 if(!state.project&&select.options.length)state.project=select.value;
 select.value=state.project;
 $(root,'studio-url').value=state.manualUrls[state.project]||'';
 select.addEventListener('change',()=>{chooseProject(select.value);onProjectChange(select.value)});
 if(state.project)onProjectChange(state.project);
 root.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>setDevice(b.dataset.device)));
 $(root,'studio-check').addEventListener('click',()=>{if(state.source==='custom'){state.currentUrl='';display(validPreview(state.manualUrls[state.project]),String(Date.now()));setStatus('Preview recarregado','ready');}else void probe({force:true})});
 $(root,'studio-open').addEventListener('click',e=>{if(!state.currentUrl){e.preventDefault();setStatus('Primeiro conecte uma publicação.','empty')}});
 $(root,'studio-full').addEventListener('click',()=>{
  const now=!root.classList.contains('studio-expanded');root.classList.toggle('studio-expanded',now);
  $(root,'studio-full').setAttribute('aria-pressed',String(now));$(root,'studio-full').textContent=now?'↙ Reduzir':'⛶ Ampliar';
  fitPreview();
 });
 $(root,'studio-connect').addEventListener('click',()=>setManual($(root,'studio-url').value));
 $(root,'studio-clear').addEventListener('click',()=>{delete state.manualUrls[state.project];$(root,'studio-url').value='';state.currentUrl='';persist();void probe({force:true})});
 $(root,'studio-frame').addEventListener('load',()=>{if(state.currentUrl)setStatus('Preview solicitado · se a tela ficar vazia, use Abrir','ready')});
 if(typeof ResizeObserver!=='undefined'){state.observer=new ResizeObserver(fitPreview);state.observer.observe($(root,'studio-canvas'));}
 window.addEventListener('resize',fitPreview);
 state.loop=setInterval(()=>void probe(),20000);
 setDevice(state.device);void probe({force:true});
}
export function notifyStudioChanged(){
 if(!state.root)return;
 void probe();
}
export function stopStudio(){
 if(state.loop){clearInterval(state.loop);state.loop=null}
 if(state.observer){state.observer.disconnect();state.observer=null}
 window.removeEventListener('resize',fitPreview);
 state.root=null;state.disposed=true;state.wantedReload=false;
}
