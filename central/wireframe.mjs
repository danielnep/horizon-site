// Horizon Orbita: architectural wireframes, independent from task execution.
const KEY='horizon.orbita.wireframes.v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const templates={button:'Botão',text:'Texto',input:'Campo',nav:'Menu',image:'Imagem',card:'Área'};
const variants={nav:[['simple','Simples'],['centered','Título central'],['brand','Marca e ações']],button:[['filled','Preenchido'],['outline','Contornado'],['soft','Suave']],card:[['surface','Painel'],['elevated','Cartão elevado']],image:[['cover','Preencher'],['contain','Imagem inteira']]};
function componentBody(e){
 const t=esc(e.text),v=e.variant||'';
 if(e.type==='image'&&/^data:image\/(png|jpeg|webp|gif);base64,/i.test(e.src||''))return '<img alt="'+t+'" src="'+esc(e.src)+'" class="wf-photo wf-photo-'+esc(v||'cover')+'">';
 if(e.type==='nav')return '<span class="wf-nav-inner wf-nav-'+esc(v||'simple')+'"><span aria-hidden="true">‹</span><strong>'+t+'</strong><span aria-hidden="true">⋯</span></span>';
 if(e.type==='input')return '<span class="wf-input-inner">'+t+'</span>';
 if(e.type==='image')return '<span class="wf-image-placeholder">＋<br>'+t+'</span>';
 return '<span>'+t+'</span>';
}
const sizes={mobile:[393,852],tablet:[800,1100],desktop:[1440,900]};
let docs=[],activeId='',pageId='',selectedId='',device='current',dirty=false,history=[];
function makeId(){return Math.random().toString(36).slice(2,11)}
function newProject(name='Novo projeto'){
 return {id:makeId(),name,palette:'#1f98ff',theme:'dark',updated:new Date().toISOString(),
  pages:[{id:makeId(),name:'Página inicial',elements:[{id:makeId(),type:'nav',text:'Cabeçalho',x:10,y:15,w:80,h:8},
   {id:makeId(),type:'text',text:'Título da tela',x:12,y:32,w:76,h:9},
   {id:makeId(),type:'button',text:'Continuar',x:20,y:65,w:60,h:9}],next:''}]};
}
function safe(v){return Math.min(95,Math.max(0,Number(v)||0))}
function save(){try{localStorage.setItem(KEY,JSON.stringify(docs));dirty=false;show('Rascunho salvo neste navegador. Exporte o JSON para backup.')}catch{show('Não foi possível salvar neste navegador.',true)}}
function show(s,bad=false){const out=document.getElementById('wf-message');if(out){out.textContent=s;out.dataset.bad=String(bad)}}
function load(){
 try{const items=JSON.parse(localStorage.getItem(KEY)||'[]');docs=Array.isArray(items)?items.slice(0,30):[]}catch{docs=[]}
 if(!docs.length)docs=[newProject()];
 activeId=docs[0].id;pageId=docs[0].pages[0].id;
}
load();
function current(){return docs.find(d=>d.id===activeId)}
function page(){return current()?.pages.find(p=>p.id===pageId)}
function activeEl(){return page()?.elements.find(e=>e.id===selectedId)}
function update(mutator){const before=JSON.stringify(current());if(before){history.push(before);if(history.length>20)history.shift()}mutator();const doc=current();if(doc)doc.updated=new Date().toISOString();dirty=true;paint();save();}
export function wireframeMarkup(){
 return '<section id="wf-root" class="wf-root" aria-label="Editor de protótipos">'+
  '<div class="wf-top"><div><strong>Arquiteto visual</strong><small>Defina layout, páginas e fluxos. Sem alterar os agentes.</small></div>'+
  '<div class="wf-file"><select id="wf-project" aria-label="Selecionar rascunho"></select><button id="wf-new" type="button" class="secondary">+ Novo projeto</button>'+
  '<button id="wf-undo" type="button" class="secondary">Desfazer</button><button id="wf-export" type="button" class="secondary">Exportar</button></div></div>'+
  '<div class="wf-options"><label>Dispositivo <select id="wf-device"><option value="current">Meu aparelho</option><option value="mobile">393 × 852</option><option value="tablet">Tablet</option><option value="desktop">Desktop</option></select></label>'+
  '<details><summary>Identidade e tema</summary><div class="wf-theme"><label>Nome <input id="wf-name" maxlength="80"></label>'+
  '<label>Cor de destaque <input id="wf-color" type="color"></label><label>Estilo <select id="wf-theme"><option value="dark">Escuro</option><option value="light">Claro</option></select></label></div></details></div>'+
  '<div class="wf-editor"><aside class="wf-side"><h3>Páginas</h3><div id="wf-pages"></div><button id="wf-add-page" type="button" class="secondary">+ Página</button>'+
  '<h3>Componentes</h3><div id="wf-tools"></div></aside>'+
  '<div class="wf-workspace"><div class="wf-ruler"><span id="wf-size-label"></span><span>Arraste os elementos</span></div>'+
  '<div id="wf-stage"><div id="wf-canvas" aria-label="Prancheta interativa"></div></div></div>'+
  '<aside class="wf-properties"><h3>Propriedades</h3><div id="wf-properties-body">Selecione um componente.</div>'+
  '<div class="wf-flow"><h3>Página e fluxo</h3><label>Nome da página <input id="wf-page-name" maxlength="65"></label><label>Após esta página <select id="wf-next"></select></label></div></aside></div>'+
  '<div class="wf-footer"><span id="wf-message" role="status">Rascunho salvo localmente</span>'+
  '<form id="wf-ai-form"><input id="wf-ai-prompt" placeholder="Ex.: desenhe um login com telefone e senha" aria-label="Comando para IA" maxlength="700">'+
  '<button class="primary" type="submit">Gerar com IA</button></form></div></section>';
}
function paint(){
 const root=document.getElementById('wf-root');if(!root)return;
 const doc=current(),p=page();if(!doc||!p)return;
 const projects=document.getElementById('wf-project');
 projects.innerHTML=docs.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===activeId?' selected':'')+'>'+esc(x.name)+'</option>').join('');
 document.getElementById('wf-name').value=doc.name;
 document.getElementById('wf-color').value=doc.palette;
 document.getElementById('wf-theme').value=doc.theme;
 document.getElementById('wf-device').value=device;
 document.getElementById('wf-pages').innerHTML=doc.pages.map(x=>'<button type="button" class="'+(x.id===pageId?'selected':'')+'" data-page-id="'+esc(x.id)+'">'+esc(x.name)+'</button>').join('');
 document.getElementById('wf-tools').innerHTML=Object.entries(templates).map(([type,name])=>'<button type="button" data-add="'+type+'">+ '+name+'</button>').join('');
 document.getElementById('wf-page-name').value=p.name;
 const next=document.getElementById('wf-next');next.innerHTML='<option value="">Fim do fluxo</option>'+doc.pages.filter(x=>x.id!==p.id).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');next.value=p.next||'';
 const size=device==='current'?[Math.round(window.innerWidth),Math.round(window.innerHeight)]:sizes[device];document.getElementById('wf-size-label').textContent=size.join(' × ')+' px CSS';
 const box=document.getElementById('wf-canvas');box.style.setProperty('--wf-accent',doc.palette);box.style.setProperty('--wf-width',size[0]+'px');box.dataset.theme=doc.theme;box.style.aspectRatio=size[0]+'/'+size[1];
 // The production CSP forbids HTML style attributes. CSSOM assignments below
 // are allowed and keep positioned components interactive without unsafe-inline.
 box.innerHTML=p.elements.map(e=>'<button type="button" class="wf-element wf-'+esc(e.type)+' wf-variant-'+esc(e.variant||'default')+(e.id===selectedId?' selected':'')+'" data-el="'+esc(e.id)+'">'+componentBody(e)+'</button>').join('');
 const nodes=box.querySelectorAll('.wf-element');
 p.elements.forEach((e,i)=>{
  const node=nodes[i];if(!node)return;
  node.style.left=safe(e.x)+'%';
  node.style.top=safe(e.y)+'%';
  node.style.width=Math.min(100-safe(e.x),Math.max(8,e.w))+'%';
  node.style.height=Math.max(5,e.h)+'%';
 });
 const el=activeEl();const detail=document.getElementById('wf-properties-body');
 detail.innerHTML=el?'<label>Texto <input id="wf-label" maxlength="100" value="'+esc(el.text)+'"></label>'+
  '<label>Largura (%) <input id="wf-width" type="number" min="8" max="100" value="'+el.w+'"></label>'+
  (variants[el.type]?'<label>Modelo <select id="wf-variant">'+variants[el.type].map(([v,n])=>'<option value="'+v+'"'+(el.variant===v?' selected':'')+'>'+n+'</option>').join('')+'</select></label>':'')+
  (el.type==='image'?'<label>Adicionar imagem <input id="wf-image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>':'')+
  '<label>Alterar este elemento com IA <input id="wf-element-prompt" placeholder="Ex.: deixe o título centralizado" maxlength="650"></label><button type="button" id="wf-element-ai">Aplicar ao elemento</button>'+
  '<div class="wf-property-actions"><button id="wf-copy" type="button">Duplicar</button><button id="wf-remove" type="button">Excluir</button></div>':
  '<p>Selecione um elemento para editar ou arraste para reposicionar.</p>';
}
export function mountWireframe(){
 if(!document.getElementById('wf-root'))return;
 paint();
 const $=id=>document.getElementById(id);
 $('wf-root').addEventListener('click',e=>{
  const el=e.target.closest('[data-el]');if(el){selectedId=el.dataset.el;paint();return}
  const p=e.target.closest('[data-page-id]');if(p){pageId=p.dataset.pageId;selectedId='';paint();return}
  const add=e.target.closest('[data-add]');if(add){update(()=>page().elements.push({id:makeId(),type:add.dataset.add,text:templates[add.dataset.add],x:18,y:42,w:64,h:8}));return}
  if(e.target.id==='wf-element-ai'&&activeEl()){void editOne();return}
  if(e.target.id==='wf-copy'&&activeEl()){update(()=>{const a=activeEl();page().elements.push({...a,id:makeId(),y:Math.min(a.y+12,88)});selectedId=page().elements.at(-1).id;});return}
  if(e.target.id==='wf-remove'){update(()=>{page().elements=page().elements.filter(a=>a.id!==selectedId);selectedId=''});return}
 });
 $('wf-undo').onclick=()=>{const previous=history.pop();if(!previous){show('Nenhuma alteração para desfazer.');return}const replacement=JSON.parse(previous);const index=docs.findIndex(x=>x.id===replacement.id);if(index>=0)docs[index]=replacement;pageId=replacement.pages.some(p=>p.id===pageId)?pageId:replacement.pages[0].id;selectedId='';paint();save()};
 $('wf-new').onclick=()=>{const name='Novo projeto '+(docs.length+1);const doc=newProject(name);docs.push(doc);activeId=doc.id;pageId=doc.pages[0].id;selectedId='';paint();save()};
 $('wf-project').onchange=e=>{activeId=e.target.value;pageId=current().pages[0].id;selectedId='';paint()};
 $('wf-device').onchange=e=>{device=e.target.value;paint()};
 $('wf-add-page').onclick=()=>update(()=>{const p={id:makeId(),name:'Página '+(current().pages.length+1),elements:[],next:''};current().pages.push(p);pageId=p.id;selectedId=''});
 $('wf-next').onchange=e=>update(()=>page().next=e.target.value);
 $('wf-page-name').onchange=e=>update(()=>{page().name=e.target.value.trim().slice(0,65)||'Página'});
 $('wf-name').onchange=e=>update(()=>{current().name=e.target.value.trim()||'Novo projeto'});
 $('wf-color').onchange=e=>update(()=>{current().palette=e.target.value});
 $('wf-theme').onchange=e=>update(()=>{current().theme=e.target.value});
 $('wf-properties-body').addEventListener('change',e=>{
  if(!activeEl())return;
  if(e.target.id==='wf-image-file'){
   const file=e.target.files?.[0];if(!file)return;
   if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>900000){show('Escolha uma imagem PNG, JPG, WebP ou GIF de até 900 KB.',true);return}
   const id=selectedId,reader=new FileReader();
   reader.onload=()=>{const target=page()?.elements.find(x=>x.id===id);if(target)update(()=>{target.src=String(reader.result)})};
   reader.onerror=()=>show('Não foi possível carregar a imagem.',true);reader.readAsDataURL(file);return;
  }
  const key={'wf-label':'text','wf-width':'w','wf-variant':'variant'}[e.target.id];if(!key)return;
  update(()=>activeEl()[key]=key==='w'?Math.min(100,Math.max(8,Number(e.target.value)||40)):e.target.value);
 });
 async function editOne(){
  const selected=activeEl(),prompt=$('wf-element-prompt')?.value.trim();if(!selected||!prompt||prompt.length<12){show('Descreva a mudança com pelo menos 12 caracteres.',true);return}
  const id=selected.id,pageAtStart=pageId,projectAtStart=activeId,button=$('wf-element-ai');button.disabled=true;show('Alterando somente o elemento selecionado…');
  try{
   const context='Identidade visual: '+current().theme+', cor '+current().palette+'. Altere apenas este elemento, preserve seu tipo. '+prompt;
   const response=await fetch('/central/api/ai/wireframe',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:context.slice(0,650),elements:[{type:selected.type,text:selected.text,x:selected.x,y:selected.y,w:selected.w,h:selected.h}]})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'IA indisponível');
   const result=data.elements?.find(x=>x.type===selected.type);if(!result)throw Error('A IA não retornou o tipo do elemento selecionado.');
   if(pageId!==pageAtStart||activeId!==projectAtStart||!page().elements.some(x=>x.id===id))throw Error('O contexto mudou; selecione o elemento novamente.');
   update(()=>{const target=page().elements.find(x=>x.id===id);Object.assign(target,result,{id})});show('Elemento atualizado pela IA; os demais foram preservados.');
  }catch(err){show('IA: '+err.message,true)}finally{if(button.isConnected)button.disabled=false}
 }
 let dragging=null;
 $('wf-canvas').addEventListener('pointerdown',e=>{
  const el=e.target.closest('[data-el]');if(!el)return;
  const a=page().elements.find(x=>x.id===el.dataset.el);if(!a)return;
  selectedId=a.id;
  dragging={id:a.id,startX:e.clientX,startY:e.clientY,x:a.x,y:a.y};
  el.setPointerCapture(e.pointerId);
 });
 $('wf-canvas').addEventListener('pointermove',e=>{
  if(!dragging)return;
  const box=$('wf-canvas').getBoundingClientRect(),a=page().elements.find(x=>x.id===dragging.id);
  if(!a)return;
  a.x=Math.min(100-a.w,Math.max(0,dragging.x+(e.clientX-dragging.startX)/box.width*100));
  a.y=Math.min(94,Math.max(0,dragging.y+(e.clientY-dragging.startY)/box.height*100));
  const node=$('wf-canvas').querySelector('[data-el="'+dragging.id+'"]');
  if(node){node.style.left=a.x+'%';node.style.top=a.y+'%'}
 });
 $('wf-canvas').addEventListener('pointerup',()=>{if(dragging){dragging=null;update(()=>{})}});
 $('wf-export').onclick=()=>{
  const blob=new Blob([JSON.stringify(current(),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='horizon-rascunho-'+current().id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  show('Arquivo do protótipo exportado. Repositório GitHub ainda não criado.');
 };
 $('wf-ai-form').onsubmit=async e=>{
  e.preventDefault();
  const prompt=$('wf-ai-prompt').value.trim();
  if(prompt.length<12){show('Descreva o que deseja desenhar.',true);return}
  const button=e.target.querySelector('button');button.disabled=true;show('Desenhando com a IA da VPS…');
  try{
   const response=await fetch('/central/api/ai/wireframe',{method:'POST',
    credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({prompt:('Identidade visual: '+current().theme+', cor '+current().palette+'. '+prompt).slice(0,650),elements:page().elements.map(({type,text,x,y,w,h})=>({type,text,x,y,w,h}))})});
   const data=await response.json();
   if(!response.ok){
    if(response.status===401){const gate=document.getElementById('gate');if(gate)gate.hidden=false;}
    throw Error(data.error||'IA indisponível');
   }
   update(()=>{const existing=page().elements;const images=existing.filter(e=>e.type==='image'&&e.src);let nextImage=0;page().elements=data.elements.map(e=>{const prior=e.type==='image'?images[nextImage++]:null;return {...e,id:makeId(),...(prior?{src:prior.src,variant:prior.variant}: {})}});page().elements.push(...images.slice(nextImage));selectedId=''});
   show('Protótipo atualizado pela '+String(data.model||data.provider)+' e salvo localmente.');
  }catch(err){show('IA: '+err.message,true)}
  finally{button.disabled=false}
 };
}
