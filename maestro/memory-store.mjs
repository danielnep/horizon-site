// Memory for approved, non-sensitive engineering events. Persist on an attached volume.
import {mkdir,open,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const MAX=2000;
export function validateEvent(event){
 if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Evento invalido');
 const text=(k)=>{const x=event[k];if(typeof x!=='string'||!x.trim()||x.length>MAX)throw Error('Campo invalido: '+k);return x.trim()};
 const id=text('id'),repo=text('repo'),kind=text('kind'),summary=text('summary'),evidence=text('evidence');
 if(!/^[a-z0-9][a-z0-9._-]{4,90}$/i.test(id))throw Error('ID invalido');
 if(!/^danielnep\/[a-z0-9._-]+$/i.test(repo))throw Error('Repo nao autorizado');
 if(!['observation','decision','test','bug','fix','checkpoint'].includes(kind))throw Error('Tipo invalido');
 const payload={schema:1,id,repo,kind,summary,evidence,at:event.at||new Date().toISOString()};
 for(const value of Object.values(payload)){
  if(typeof value==='string'&&/(?:AIza[\w-]{16,}|sk-[\w-]{12,}|Bearer\s+[a-z0-9._-]{12,}|-----BEGIN .*PRIVATE KEY-----)/i.test(value))throw Error('Possivel segredo; registro recusado');
 }
 if(!Number.isFinite(Date.parse(payload.at)))throw Error('Data invalida');
 return payload;
}
export class MaestroMemory{
 constructor(root){if(typeof root!=='string'||!root.trim())throw Error('Diretorio de memoria obrigatorio');this.root=resolve(root)}
 async append(event){
  const e=validateEvent(event), dir=join(this.root,'events');
  await mkdir(dir,{recursive:true});
  const filename=join(dir,e.id+'.json'), content=JSON.stringify(e)+'\n';
  try{const file=await open(filename,'wx',0o600);try{await file.writeFile(content)}finally{await file.close()};return {created:true,event:e}}
  catch(err){if(err.code!=='EEXIST')throw err;
   const old=JSON.parse(await readFile(filename,'utf8'));
   if(JSON.stringify(old)!==JSON.stringify(e))throw Error('Conflito de idempotencia: '+e.id);
   return {created:false,event:old};
  }
 }
 async find({repo=null,kind=null,query='',limit=40}={}){
  const n=Math.min(200,Math.max(1,Number(limit)||40));let files=[];
  try{files=await readdir(join(this.root,'events'))}catch(e){if(e.code==='ENOENT')return [];throw e}
  const out=[];
  for(const file of files.filter(x=>/^[a-z0-9._-]+\.json$/i.test(x))){
   try{
    const e=JSON.parse(await readFile(join(this.root,'events',file),'utf8'));
    if(repo&&e.repo!==repo)continue;if(kind&&e.kind!==kind)continue;
    if(query&&!JSON.stringify(e).toLowerCase().includes(String(query).toLowerCase()))continue;
    out.push(e);
   }catch(e){if(e.code!=='ENOENT')throw e}
  }
  return out.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,n);
 }
}
