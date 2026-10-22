// Horizonte MCP: stateless Streamable HTTP server for ChatGPT.
// Never returns secrets, never accepts raw commands or arbitrary GitHub API requests.
import { timingSafeEqual } from 'node:crypto';
import {vpsRequest} from '../central/vps-client.mjs';

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
 {name:'horizon_task_status',description:'Consulta estado do trabalho diretamente no SQLite ativo da VPS sem consultar GitHub.',inputSchema:taskIdInput,annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'horizon_submit_task',description:'Registra tarefa no SQLite vivo do Maestro na VPS, sem fila paralela ou GitHub Actions. Aceite nao e conclusao.',inputSchema:submitInput,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:'horizon_sync_status',description:'Consulta politica de sincronizacao agentes↔plugins no repositorio publico, sem fazer publicacao.',inputSchema:agentInput,annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'horizon_vps_health',description:'Confere conectividade real do supervisor Python, agentes e banco SQLite na VPS sem revelar dados privados.',inputSchema:agentInput,annotations:{readOnlyHint:true,openWorldHint:false}}
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
  const vpsCall=options.vpsRequester||vpsRequest;
  if(name==='horizon_list_agents'){
    try{
      const snapshot=await vpsCall('/v1/snapshot');
      const names=Array.isArray(snapshot.agents)?snapshot.agents.map(x=>x.id).filter(x=>AGENTS.includes(x)):[];
      return toolResponse({agents:names,count:names.length,worker:snapshot.worker?.status||'unknown',source:'vps_sqlite'});
    }catch(error){return toolResponse({error:'vps_desconectada',detail:String(error.message||'').slice(0,70)},true);}
  }
  if(name==='horizon_task_status'){
    if(typeof a?.task_id!=='string'||!ID.test(a.task_id))return toolResponse({error:'task_id_invalido'},true);
    try{
      const snapshot=await vpsCall('/v1/snapshot');
      const task=Array.isArray(snapshot.tasks)?snapshot.tasks.find(x=>x.id===a.task_id):null;
      if(!task)return toolResponse({id:a.task_id,status:'nao_encontrada_no_recorte',source:'vps_sqlite'});
      return toolResponse({id:task.id,status:task.status,agent:task.agent,hasResult:task.hasResult===true,source:'vps_sqlite'});
    }catch(error){return toolResponse({error:String(error.message||'vps_indisponivel').slice(0,100)},true);}
  }
  if(name==='horizon_vps_health'){
    try{
      const snapshot=await vpsCall('/v1/snapshot');
      return toolResponse({source:'vps_sqlite',connected:true,worker:snapshot.worker?.status||'unknown',agents:Array.isArray(snapshot.agents)?snapshot.agents.length:0,queueSize:Array.isArray(snapshot.tasks)?snapshot.tasks.filter(t=>t.inQueue===true).length:0});
    }catch(error){return toolResponse({connected:false,error:String(error.message||'vps_indisponivel').slice(0,100)},true);}
  }

  if(name==='horizon_sync_status'){
    const r=await gh('contents/docs/plugin-sync.json?ref=main',options);
    if(r.status===404)return toolResponse({configured:false});
    return toolResponse({configured:true,policy:decodeFile(r.body)});
  }
  if(name==='horizon_submit_task'){
    if(!a||typeof a!=='object'||!AGENTS.includes(a.agent)||
      typeof a.objective!=='string'||a.objective.length<12||a.objective.length>2800||
      typeof a.repository!=='string'||!/^danielnep\/[A-Za-z0-9_.-]{2,90}$/.test(a.repository)||
      !Array.isArray(a.allowed_paths)||a.allowed_paths.length>35||
      a.allowed_paths.some(p=>typeof p!=='string'||!p||p.length>150)||
      a.public_data_confirmed!==true)return toolResponse({error:'solicitacao_invalida_ou_nao_confirmada'},true);
    try{
      const answer=await vpsCall('/v1/tasks',{method:'POST',data:{
        agent:a.agent,repository:a.repository,objective:a.objective,
        allowed_paths:a.allowed_paths,priority:a.priority||'P2',
        public_data_confirmed:true,delivery_type:a.delivery_type||'existing_product'}});
      return toolResponse({...answer,source:'vps_sqlite',note:'Aceite nao representa execucao. Acompanhe com horizon_task_status.'});
    }catch(error){return toolResponse({error:String(error.message||'vps_indisponivel').slice(0,100)},true);}
  }
  throw Error('Unknown tool');
}
export async function handleHorizonMcp(req,res,{fetcher=fetch,token=process.env.HORIZON_MCP_TOKEN,githubToken=process.env.HORIZON_MCP_GITHUB_TOKEN,vpsRequester=vpsRequest}={}){
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
      else output=result(id,await handleTool(name,args,{fetcher,token:githubToken,vpsRequester}));
    }else output=err(id,-32601,'Method not found');
  }catch(e){output=result(id,toolResponse({error:'upstream_error',message:String(e?.message||e).slice(0,160)},true));}
  reply(res,200,output,{'mcp-protocol-version':VERSION});
}

[executed on device: srv2085016 (56be333d-f9c8-4f1e-8334-abe11feefac3)]