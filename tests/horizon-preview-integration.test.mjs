import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer,TOOL_ASSETS} from '../server.mjs';
import {TOOLS,TOOL_IDS} from '../ferramentas/core/tools.js';
import {DemoStore} from '../ferramentas/core/store.js';

async function serve(t) {
  const server=startServer({listenPort:0,background:false});
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
test('site preserva rotas tradicionais e publica ferramenta no mesmo domínio',async t=>{
  const url=await serve(t);
  let r=await fetch(url+'/');
  assert.equal(r.status,200);
  const html=await r.text();
  assert.match(html,/id="inicio"/);
  assert.match(html,/id="contato"/);
  assert.match(html,/data-builder-tool="planilhas"/);
  assert.match(html,/data-builder-tool="comprovantes"/);
  assert.match(html,/id="builder-launch"/);
  assert.match(html,/href="\/ferramentas\/#ferramentas"/);
  assert.match(html,/const url=new URL\('\/ferramentas\/',window.location.origin\)/);
  r=await fetch(url+'/health');
  assert.equal(r.status,200);
  assert.equal((await r.json()).status,'ok');
  r=await fetch(url+'/ferramentas',{redirect:'manual'});
  assert.equal(r.status,308);
  assert.equal(r.headers.get('location'),'/ferramentas/');
});
test('cada asset do Preview é servido, com MIME correto e método HEAD',async t=>{
  const url=await serve(t);
  assert.equal(Object.keys(TOOL_ASSETS).length,12);
  for(const [asset,type] of Object.entries(TOOL_ASSETS)){
    const path='/ferramentas/'+(asset==='index.html'?'':asset);
    const response=await fetch(url+path);
    assert.equal(response.status,200,asset);
    assert.ok(response.headers.get('content-type').startsWith(type),asset);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const body=await response.arrayBuffer();
    assert.ok(body.byteLength>100,asset);
    const head=await fetch(url+path,{method:'HEAD'});
    assert.equal(head.status,200,asset);
    assert.equal((await head.arrayBuffer()).byteLength,0,asset);
  }
});
test('interface ligada à Horizon e sem cadastro de dados fictícios no site institucional',async t=>{
  const url=await serve(t);
  const preview=await (await fetch(url+'/ferramentas/?f=checklists,servicos#solucao')).text();
  assert.match(preview,/Voltar ao site Horizon/);
  assert.match(preview,/Ferramentas Horizon/);
  assert.match(preview,/src="\.\/assets\/horizon-logo.png"/);
  assert.match(preview,/site-bridge.css/);
  assert.match(preview,/src="\.\/app.js"/);
  const config=await (await fetch(url+'/ferramentas/config.js')).text();
  assert.match(config,/storageKey:/);
  assert.match(config,/googleSheetsUrl: ''/);
});
test('o seletor do site corresponde exatamente às oito ferramentas e às 255 combinações possíveis',async()=>{
  const site=await readFile(new URL('../index.html',import.meta.url),'utf-8');
  const ids=[...site.matchAll(/data-builder-tool="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids,TOOL_IDS);
  assert.equal(TOOLS.length,8);
  assert.equal((1<<ids.length)-1,255);
  const store=new DemoStore({storage:null});
  for(let bitmap=1;bitmap<(1<<ids.length);bitmap++){
    const selected=ids.filter((_,i)=>(bitmap&(1<<i))!==0);
    store.selectTools(selected);
    assert.deepEqual(store.state.selected,selected);
  }
});
test('arquivo estático não admite traversal, rotas internas ou escrita por HTTP',async t=>{
  const url=await serve(t);
  for(const path of ['/ferramentas/.env','/ferramentas/integrations/Code.gs',
    '/ferramentas/../../server.mjs','/ferramentas/%2e%2e%2fserver.mjs',
    '/ferramentas/core/missing.js','/server.mjs']){
    const r=await fetch(url+path);
    assert.equal(r.status,404,path);
  }
  let res=await fetch(url+'/ferramentas/app.js',{method:'POST'});
  assert.equal(res.status,405);
  assert.equal(res.headers.get('allow'),'GET, HEAD');
  res=await fetch(url+'/ferramentas/%ZZ');
  assert.equal(res.status,400);
});

