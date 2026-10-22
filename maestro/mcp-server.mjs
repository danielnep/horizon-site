// Horizonte MCP: stateless Streamable HTTP server for ChatGPT.
// Never returns secrets, never accepts raw commands or arbitrary GitHub API requests.
import { timingSafeEqual } from 'node:crypto';
import {submitDirectTask,directStatus} from './direct-queue.mjs';

const CONTROL_REPO='danielnep/May-Maestro-Executor';
const AGENTS=Object.freeze([
  'may-maestro','horizon-project-studio','software-architect',
  'frontend-engineer','backend-engineer','mobile-app-builder','ui-ux-designer',
  'horizon-ui-guardian','database-engineer','integration-engineer','qa-engineer',
  'security-engineer','devops-engineer','horizon-evolution-agent','horizon-skills',
  'corregedoria-may','may-persona'
]);
const VERSION='2025-11-25';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;
const MODULE='horizon-bridge';
const agentInput={type:'object',properties:{},additionalProperties:false};
const taskIdInput={type:'object',properties:{task_id:{type:'string',description:'ID de uma tarefa autorizada, sem informacoes pessoais.'}},required:['task_id'],additionalProperties:false};
const submitInput={type:'object',properties:{
 task_id:{type:'string',description:'Identificador único da solicitação'},
 project:{type:'string',description:'Identificador do projeto'},
 repository:{type:'string',description:'Repositório do aplicativo, por exemplo danielnep/romaneio-digital'},
 objective:{type:'string',description:'Missão e critérios, sem segredos'},
 agent:{type:'string',enum:AGENTS},
 delivery_type:{type:'string',enum:['existing_product','new_product']},
 priority:{type:'string',enum:['P0','P1','P2','P3']},
 public_data_confirmed:{type:'boolean',description:'Confirma que o objetivo não contém segredos de clientes'},
 allowed_paths:{type:'array',items:{type:'string'},maxItems:25}
},required:['task_id','project','repository','objective','agent','public_data_confirmed','allowed_paths'],
 additionalProperties:false};
const TOOLS=Object.freeze([
 {name:'horizon_list_agents',description:'Retorna os 17 agentes do executor Horizon com nomes verificaveis. Nao inicia agentes.',inputSchema:agentInput,annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'horizon_task_status',description:'Consulta recebimento e resultados da fila interna da VPS Horizon, sem consultar GitHub.',inputSchema:taskIdInput,annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'horizon_submit_task',description:'Entrega ao Maestro na VPS em fila local persistente, sem GitHub Actions. Nao confunde aceite com conclusao.',inputSchema:submitInput,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:'horizon_sync_status',description:'Consulta politica de sincronizacao agentes↔plugins no repositorio publico, sem fazer publicacao.',inputSchema:agentInput,annotations:{readOnlyHint:true,openWorldHint:false}}
]);
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
const reply=(res,status,body,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(body));};
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const result=(id,result)=>({jsonrpc:'2.0',id,result});
const toolResponse=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],isError});
async function gh(path,{method='GET',body,token=process.env.HORIZON_MCP_GITHUB_TOKEN,fetcher=fetch}={}){
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':MODULE};
  if(token)headers.Authorization=`Bearer ${token}`;
  const response=await fetcher(`https://api.github.com/repos/${CONTROL_REPO}/${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body),headers:{...headers,'content-type':'application/json'}}),signal:AbortSignal.timeout(12000)});
  if(response.status===404)return {status:404,body:null};
  if(response.status===422)return {status:422,body:null};
  if(!response.ok)throw Error(`GitHub ${response.status}`);
  const obj=await response.json();return {status:response.status,body:obj};
}
function decodeFile(body){const content=body?.content;if(typeof content!=='string')return null;const raw=Buffer.from(content.replace(/\s/g,''),'base64').toString('utf8');if(Buffer.byteLength(raw)>65000)throw Error('Arquivo acima do limite');return JSON.parse(raw);}
async function handleTool(name,a,options={}){
  if(name==='horizon_list_agents')return toolResponse({agents:AGENTS,source:CONTROL_REPO,count:AGENTS.length});
  if(name==='horizon_task_status'){
    try{return toolResponse(await directStatus(a?.task_id));}
    catch(error){return toolResponse({error:String(error.message||'unavailable').slice(0,80)},true);}
  }
  if(name==='horizon_sync_status'){
    const r=await gh('contents/docs/plugin-sync.json?ref=main',options);
    if(r.status===404)return toolResponse({configured:false});
    return toolResponse({configured:true,policy:decodeFile(r.body)});
  }
  if(name==='horizon_submit_task'){
    try{return toolResponse(await submitDirectTask(a));}
    catch(error){return toolResponse({error:String(error.message||'submit_failed').slice(0,100)},true);}
  }
  throw Error('Unknown tool');
}
export async function handleHorizonMcp(req,res,{fetcher=fetch,token=process.env.HORIZON_MCP_TOKEN,githubToken=process.env.HORIZON_MCP_GITHUB_TOKEN}={}){
  if(req.method!=='POST'){reply(res,405,{error:'Only POST supported'},{allow:'POST'});return;}
  const origin=req.headers.origin;
  if(origin&&!['https://chatgpt.com','https://chat.openai.com'].includes(origin)){reply(res,403,{error:'Origin not permitted'});return;}
  if(!token){reply(res,503,{error:'MCP not configured'});return;}
  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!safeEqual(token,bearer)){reply(res,401,{error:'Unauthorized'},{'www-authenticate':'Bearer realm="Horizon MCP"'});return;}
  const type=req.headers['content-type']||'';
  if(!type.startsWith('application/json')){reply(res,415,{error:'JSON required'});return;}
  const chunks=[];let n=0;
  try{for await(const c of req){n+=c.length;if(n>65536){reply(res,413,{error:'Payload too large'});return;}chunks.push(c);}}
  catch{reply(res,400,{error:'Bad payload'});return;}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reply(res,400,err(null,-32700,'Parse error'));return;}
  if(!input||Array.isArray(input)||input.jsonrpc!=='2.0'||typeof input.method!=='string'){reply(res,400,err(null,-32600,'Invalid Request'));return;}
  const id=input.id??null;
  if(id===null&&input.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  let output;
  try{
    if(input.method==='initialize')output=result(id,{protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'horizon-agents',version:'1.0.0'},instructions:'Ferramentas dos 17 especialistas. Envie solicitações diretamente ao Maestro na VPS; tarefas e resultados ficam em armazenamento privado. Aceite não significa conclusão.'});
    else if(input.method==='ping')output=result(id,{});
    else if(input.method==='tools/list')output=result(id,{tools:TOOLS});
    else if(input.method==='tools/call'){
      const name=input.params?.name; const args=input.params?.arguments??{};
      if(!TOOLS.some(t=>t.name===name)){output=err(id,-32602,'Unknown tool');}
      else output=result(id,await handleTool(name,args,{fetcher,token:githubToken}));
    }else output=err(id,-32601,'Method not found');
  }catch(e){output=result(id,toolResponse({error:'upstream_error',message:String(e?.message||e).slice(0,160)},true));}
  reply(res,200,output,{'mcp-protocol-version':VERSION});
}