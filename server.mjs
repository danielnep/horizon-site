import http from 'node:http';
import {handleHorizonMcp} from './maestro/mcp-server.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startScheduledReviewer} from './maestro-worker.mjs';
import {handleAgentState} from './maestro/embedded-postgres.mjs';
import {inspectVolume} from './maestro/volume-inventory.mjs';
import {retirementConfirmed,retireLegacyVolume} from './maestro/retire-legacy-volume.mjs';
const indexPath=fileURLToPath(new URL('./index.html',import.meta.url));
// Primeira ferramenta Horizon: um workspace próprio, hospedado no mesmo domínio.
// Lista explícita evita exposição de arquivos internos e caminhos fora da pasta.
export const TOOL_ASSETS=Object.freeze({
  'index.html':'text/html; charset=utf-8',
  'app.js':'text/javascript; charset=utf-8',
  'config.js':'text/javascript; charset=utf-8',
  'styles.css':'text/css; charset=utf-8',
  'horizon-theme.css':'text/css; charset=utf-8',
  'site-bridge.css':'text/css; charset=utf-8',
  'core/tools.js':'text/javascript; charset=utf-8',
  'core/store.js':'text/javascript; charset=utf-8',
  'core/demonstration.js':'text/javascript; charset=utf-8',
  'core/assistants.js':'text/javascript; charset=utf-8',
  'integrations/google-sheets.js':'text/javascript; charset=utf-8',
  'assets/horizon-logo.png':'image/png'
});

export function startServer({listenPort=Number(process.env.PORT||3000),reader=readFile,background=true}={}) {
  const server=http.createServer(async(req,res)=>{
    const path=(req.url||'/').split('?')[0];
    if(path==='/mcp'){await handleHorizonMcp(req,res);return;}
    if(path==='/api/internal/horizon-agent-state'){
      if(retirementConfirmed()){
        res.writeHead(410,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({error:'legacy_archive_retired',activeBackend:'github-encrypted-sqlite'}));
        return;
      }
      await handleAgentState(req,res);return;
    }
    if(path==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({status:'ok'}));return;}
    if(path==='/ferramentas'){
      res.writeHead(308,{'location':'/ferramentas/','cache-control':'no-store'});
      res.end();return;
    }
    if(path==='/ferramentas/'||path.startsWith('/ferramentas/')){
      if(req.method!=='GET'&&req.method!=='HEAD'){
        res.writeHead(405,{'content-type':'text/plain','allow':'GET, HEAD'});
        res.end('Método não permitido');return;
      }
      let route;
      try{route=decodeURIComponent(path.slice('/ferramentas/'.length))||'index.html';}
      catch {res.writeHead(400,{'content-type':'text/plain'});res.end('URL inválida');return;}
      if(!Object.hasOwn(TOOL_ASSETS,route)){
        res.writeHead(404,{'content-type':'text/plain','x-content-type-options':'nosniff'});
        res.end('Não encontrado');return;
      }
      try{
        const assetPath=fileURLToPath(new URL('./ferramentas/'+route,import.meta.url));
        const asset=await reader(assetPath);
        const cache=route==='index.html'||route.endsWith('.js')||route.endsWith('.css')?'no-cache':'public, max-age=3600';
        res.writeHead(200,{'content-type':TOOL_ASSETS[route],'cache-control':cache,'x-content-type-options':'nosniff'});
        res.end(req.method==='HEAD'?undefined:asset);
      }catch{
        res.writeHead(503,{'content-type':'text/plain'});
        res.end('Ferramentas indisponíveis');
      }
      return;
    }

    if((req.method==='GET'||req.method==='HEAD')&&(path==='/'||path==='/index.html')){
      try{const html=await reader(indexPath);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:html);}
      catch{res.writeHead(503);res.end('Site indisponivel');}
      return;
    }
    res.writeHead(404,{'content-type':'text/plain'});res.end('Nao encontrado');
  });
  const stop=background?startScheduledReviewer():()=>{};
  // The active worker uses encrypted SQLite checkpoints on GitHub.
  // Never eagerly open/VACUUM the full legacy PGlite volume on normal site startup.
  // Its authenticated GET endpoint may still recover a verified historical snapshot.
  console.log('[horizon-agent-db] legacy PGlite preserved; initialization deferred');
  // Startup maintenance is an explicit owner-armed, SHA-pinned one-time retirement.
  // The legacy endpoint is disabled before any deletion, and active handoffs remain untouched.
  if(background){
    void (async()=>{
      try{
        const retired=await retireLegacyVolume();
        if(retired.status==='disabled')console.log('[horizon-legacy-retirement] disabled');
        else if(retired.status==='already_retired')console.log('[horizon-legacy-retirement] already retired');
      }catch(e){console.error('[horizon-legacy-retirement-error] '+String(e?.code||e?.message||e).slice(0,150));}
      try{
        const inventory=await inspectVolume();
        console.log('[horizon-volume-inventory] '+JSON.stringify(inventory));
      }catch(e){console.error('[horizon-volume-inventory-error] '+String(e?.code||e?.message||e).slice(0,120));}
    })();
  }
  server.on('close',stop);
  server.listen(listenPort,'0.0.0.0');
  return server;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href) startServer();