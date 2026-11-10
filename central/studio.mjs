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

 const checkButton=$(root,'studio-check');checkButton.disabled=true;
 try{
  if(!project){
   display('');
   setStatus('Escolha um projeto para consultar a publicação.','empty');
   return;
  }
  state.source='vps';setStatus('Consultando aplicativo na VPS…');
  const response=await fetch('/central/api/studio/preview?appId='+encodeURIComponent(project),{cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(project!==state.project||state.disposed)return;
  if(!response.ok||!data.ready||!validPreview(data.url)){
   display('');setStatus(data.message||'Aplicativo da VPS não acessível','empty');
   return;
  }
  if(force)state.lastRevision='manual-refresh-'+Date.now();
  display(data.url,data.revision||'');
  setStatus('VPS · '+(data.httpStatus===200?'publicação ativa':'publicação protegida'),'ready');
 }catch{
  if(project===state.project){display('');setStatus('Não foi possível consultar o aplicativo na VPS.','error');}
 }finally{state.checking=false;if(state.root===root)checkButton.disabled=false;
  if(state.wantedReload&&!state.disposed){state.wantedReload=false;queueMicrotask(()=>void probe({force:true}));}}
}
function chooseProject(value){
 if(!value||value===state.project)return;
 state.project=value;state.currentUrl='';state.lastRevision='';persist();
 const root=state.root;

 display('');void probe({force:true});
}
function setManual(value){
 const url=validPreview(value);
 if(value.trim()&&!url){setStatus('Informe um endereço HTTPS público, diferente do endereço da Central.','error');return}
 if(url)state.manualUrls[state.project]=url;else delete state.manualUrls[state.project];
 state.currentUrl='';state.lastRevision='';persist();void probe({force:true});
}
export function studioMarkup(repositories=[]){
 const available=repositories.filter(r=>r&&/^[a-z][a-z0-9-]+$/.test(r.id)&&/^https:\/\/[a-z0-9.-]+\.hzsys\.tech\/$/.test(r.url));
 if(!available.some(r=>r.id===state.project))state.project=available[0]?.id||'';
 const options=available.map(r=>'<option value="'+safe(r.id)+'"'+(state.project===r.id?' selected':'')+'>'+safe(r.label||r.name||r.id)+'</option>').join('');
 return '<section id="studio-root" class="studio-preview" aria-label="Preview interativo">'+
  '<div class="studio-toolbar"><div class="studio-caption"><span class="studio-indicator" aria-hidden="true"></span><strong>Aplicativo na VPS</strong><small id="studio-status" role="status" aria-live="polite">Verificando publicação…</small></div>'+
  '<div class="studio-controls" role="group" aria-label="Formato da tela">'+Object.keys(SIZES).map(k=>'<button type="button" class="studio-device'+(state.device===k?' selected':'')+'" data-device="'+k+'" aria-pressed="'+(state.device===k)+'">'+SIZES[k].label+'</button>').join('')+'</div></div>'+
  '<div class="studio-project-row"><label for="studio-project">Projeto</label><select id="studio-project"'+(available.length?'':' disabled')+'>'+options+'</select><button type="button" id="studio-check" class="studio-tool" title="Verificar nova publicação">↻ <span>Atualizar</span></button></div>'+
  '<div class="studio-canvas" id="studio-canvas"><div id="studio-stage" class="studio-stage"><div id="studio-viewport" class="studio-viewport"><iframe id="studio-frame" title="Aplicativo em desenvolvimento" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerpolicy="no-referrer" hidden></iframe>'+
  '<div id="studio-blank" class="studio-blank"><span class="studio-empty-icon" aria-hidden="true">▣</span><strong>Seu aplicativo aparece aqui</strong><p>Escolha um aplicativo publicado na VPS.</p></div></div></div></div>'+
  '<div class="studio-footer"><span id="studio-dimensions">'+SIZES[state.device].width+' × '+SIZES[state.device].height+'</span><span class="studio-footer-actions"><a id="studio-open" class="studio-tool" href="#" target="_blank" rel="noopener noreferrer" aria-label="Abrir aplicação em outra guia">↗ Abrir</a><button type="button" class="studio-tool" id="studio-full" aria-pressed="false">⛶ Ampliar</button></span></div>'+
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

 select.addEventListener('change',()=>{chooseProject(select.value);onProjectChange(select.value)});
 if(state.project)onProjectChange(state.project);
 root.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>setDevice(b.dataset.device)));
 $(root,'studio-check').addEventListener('click',()=>void probe({force:true}));
 $(root,'studio-open').addEventListener('click',e=>{if(!state.currentUrl){e.preventDefault();setStatus('Primeiro conecte uma publicação.','empty')}});
 $(root,'studio-full').addEventListener('click',()=>{
  const now=!root.classList.contains('studio-expanded');root.classList.toggle('studio-expanded',now);
  $(root,'studio-full').setAttribute('aria-pressed',String(now));$(root,'studio-full').textContent=now?'↙ Reduzir':'⛶ Ampliar';
  fitPreview();
 });
 $(root,'studio-frame').addEventListener('load',()=>{if(state.currentUrl)setStatus('Prévia carregada','ready')});
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
