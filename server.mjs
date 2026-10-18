import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startScheduledReviewer} from './maestro-worker.mjs';
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
  server.on('close',stop);
  server.listen(listenPort,'0.0.0.0');
  return server;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href) startServer();