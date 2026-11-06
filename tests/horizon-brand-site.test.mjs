import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../server.mjs';

const sitePath=new URL('../index.html',import.meta.url);
async function serve(t){
  const server=startServer({listenPort:0,background:false});
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
test('site institucional mantém seções, logo e slogan oficial',async t=>{
  const url=await serve(t);
  const res=await fetch(url+'/');
  assert.equal(res.status,200);
  const html=await res.text();
  for(const id of ['inicio','solucoes','portfolio','metodo','sobre','contato'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/data:image\/png;base64,/);
  assert.match(html,/Apps, sistemas, automações e inteligência artificial para empresas\./);
  assert.match(html,/family=Manrope/);
  assert.doesNotMatch(html,/Exo\+2|Rajdhani|data-builder-tool|builder-launch|href="#ferramentas"|initHorizonBuilder/);
  const health=await fetch(url+'/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).status,'ok');
});
test('Preview fica fora do site, sem servir arquivos ou redirecionar',async t=>{
  const url=await serve(t);
  for(const path of ['/ferramentas','/ferramentas/','/ferramentas/app.js','/ferramentas/styles.css']){
    const res=await fetch(url+path,{redirect:'manual'});
    assert.equal(res.status,404,path);
  }
});
test('CSS usa apenas cinza neutro, branco e azul celeste exato',async()=>{
  const html=await readFile(sitePath,'utf8');
  const css=html.split('<style>')[1].split('</style>')[0];
  const hex=[...css.matchAll(/#(?:[a-f0-9]{8}|[a-f0-9]{6}|[a-f0-9]{4}|[a-f0-9]{3})(?![a-f0-9])/gi)].map(m=>m[0]);
  assert.ok(hex.includes('#1F98FF'));
  for(const h of hex){
    const digits=h.slice(1);
    const rgb=digits.length>=6?digits.slice(0,6).match(/../g).map(x=>parseInt(x,16)):
      digits.slice(0,3).split('').map(x=>parseInt(x+x,16));
    if(!(rgb[0]===rgb[1]&&rgb[1]===rgb[2]))
      assert.equal(h.toUpperCase(),'#1F98FF','non-brand color '+h);
  }
  assert.match(css,/font-family:Manrope/);
  assert.match(css,/font-family:Inter/);
  assert.match(css,/IBM Plex Mono/);
});
