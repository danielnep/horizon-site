// Horizonte MCP: stateless Streamable HTTP server for ChatGPT.
// Never returns secrets, never accepts raw commands or arbitrary GitHub API requests.
import { timingSafeEqual } from 'node:crypto';

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
  task_id:{type:'string',description:'ID unico 3 a 64 caracteres ASCII (letras, numeros, _ e -).'},
  project:{type:'string',description:'Projeto publico sem dados de clientes.'},
  objective:{type:'string',description:'Objetivo publico e sem segredos.'},
  agent:{type:'string',enum:AGENTS},
  public_data_confirmed:{type:'boolean',description:'Confirma que objetivo e materiais podem ficar em repositorio publico.'},
  allowed_paths:{type:'array',items:{type:'string'},maxItems:15,description:'Caminhos permitidos do repo de controle. Ausente ou vazio: somente leitura.'}
},required:['task_id','project','objective','agent','public_data_confirmed'],additionalProperties:false};
const TOOLS=Object.freeze([
 {name:'horizon_list_agents',description:'Retorna os 17 agentes do executor Horizon com nomes verificaveis. Nao inicia agentes.',inputSchema:agentInput,annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'horizon_task_status',description:'Consulta resultado publico de tarefa de agentes na fila GitHub, inclusive provas e bloqueios. Nao presume conclusao.',inputSchema:taskIdInput,annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'horizon_submit_task',description:'Envia tarefa publica e sem dados de clientes ao executor via GitHub Actions, com controles de allowlist. Requer credencial GitHub de escrita separada no servidor. A submissao NAO significa trabalho terminado.',inputSchema:submitInput,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:'horizon_sync_status',description:'Consulta politica de sincronizacao agentes↔plugins no repositorio publico, sem fazer publicacao.',inputSchema:agentInput,annotations:{readOnlyHint:true,openWorldHint:false}}
]);
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
const reply=(res,status,body,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(body));};
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const result=(id,result)=>({jsonrpc:'2.0',id,result});
const toolResponse=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],isError});
function validPath(p,project){return p===`apps/${project}/**`;}
function checkSubmit(a){
  if(!a||typeof a!=='object'||Array.isArray(a))return 'Objeto invalido';
  if(!ID.test(a.task_id||''))return 'task_id invalido';
  if(typeof a.project!=='string'||!ID.test(a.project))return 'project invalido';
  if(typeof a.objective!=='string'||a.objective.trim().length<12||a.objective.length>3000)return 'objective invalido';
  if(!AGENTS.includes(a.agent))return 'Agente nao autorizado';
  if(a.public_data_confirmed!==true)return 'Confirmacao expressa de dados publicos necessaria';
  if(a.allowed_paths!==undefined&&(!Array.isArray(a.allowed_paths)||a.allowed_paths.length>15||!a.allowed_paths.every(p=>validPath(p,a.project))))return 'allowed_paths invalidos';
  return null;
}
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
    if(!ID.test(a?.task_id||''))return toolResponse({error:'task_id invalido'},true);
    const r=await gh(`contents/tasks/results/${a.task_id}.json?ref=main`,options);
    if(r.status===404)return toolResponse({task_id:a.task_id,status:'not_found',note:'Nao ha recibo confirmado na branch main; nao implica que a tarefa nao esteja na fila.'});
    return toolResponse({task_id:a.task_id,result:decodeFile(r.body)});
  }
  if(name==='horizon_sync_status'){
    const r=await gh('contents/docs/plugin-sync.json?ref=main',options);
    if(r.status===404)return toolResponse({configured:false});
    return toolResponse({configured:true,policy:decodeFile(r.body)});
  }
  if(name==='horizon_submit_task'){
    const why=checkSubmit(a);if(why)return toolResponse({error:why},true);
    const token=options.token??process.env.HORIZON_MCP_GITHUB_TOKEN;
    if(!token)return toolResponse({error:'github_write_not_configured',action:'Configurar HORIZON_MCP_GITHUB_TOKEN em variaveis Railway; nao enviar segredo na tarefa.'},true);
    const path=`tasks/chat/${a.task_id}.json`;
    const existing=await gh(`contents/${path}?ref=main`,{...options,token});
    if(existing.status!==404)return toolResponse({error:'task_id_ja_existe',task_id:a.task_id},true);
    const body={owner:'danielnep',repository:CONTROL_REPO,task_id:a.task_id,agent:a.agent,project:a.project,objective:a.objective,delivery_type:'new_product',payload:{allowed_paths:a.allowed_paths??[]}};
    const content=Buffer.from(JSON.stringify(body,null,2)+'\n').toString('base64');
    const saved=await gh(`contents/${path}`,{...options,token,method:'PUT',body:{message:`chore(chat): encaminhar pedido MCP ${a.task_id}`,content,branch:'main'}});
    if(saved.status===422)return toolResponse({error:'task_conflict'},true);
    return toolResponse({task_id:a.task_id,status:'submitted',commit:saved.body?.commit?.sha??null,result_hint:`tasks/results/${a.task_id}.json`,note:'Submetido ao GitHub; nao foi executado nem validado nesta chamada.'});
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
    if(input.method==='initialize')output=result(id,{protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'horizon-agents',version:'1.0.0'},instructions:'Ponte entre ChatGPT May e 17 especialistas. Tarefas ficam no GitHub publico; nao enviar dados pessoais ou sigilosos. Submissao nao comprova execucao.'});
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