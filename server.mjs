import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startScheduledReviewer} from './maestro-worker.mjs';
const indexPath=fileURLToPath(new URL('./index.html',import.meta.url));
export function startServer({listenPort=Number(process.env.PORT||3000),reader=readFile,background=true}={}) {
  const server=http.createServer(async(req,res)=>{
    const path=(req.url||'/').split('?')[0];
    if(path==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({status:'ok'}));return;}
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