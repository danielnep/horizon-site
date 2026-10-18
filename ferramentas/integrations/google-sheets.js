// Adaptador explícito para registros REAIS. Nunca conectado automaticamente ao DemoStore.
export function validateEndpoint(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&url.hostname==='script.google.com'&&/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)&&!url.username&&!url.password;}catch{return false;}
}
function trustedResponseOrigin(origin) {
  try{const url=new URL(origin);return url.protocol==='https:'&&(url.hostname==='script.google.com'||url.hostname==='script.googleusercontent.com'||url.hostname.endsWith('-script.googleusercontent.com'));}catch{return false;}
}
export function sendRealRecord(endpoint,record,{timeout=20000}={}) {
  if(!validateEndpoint(endpoint))return Promise.reject(new Error('Configure um endereço válido do Google Apps Script.'));
  if(!record||!['teste','real'].includes(record.kind)||!String(record.title||'').trim()||!String(record.owner||'').trim())return Promise.reject(new Error('Informe tipo, título e responsável pelo registro real.'));
  const requestId=crypto.randomUUID(),recordId=record.id||crypto.randomUUID();
  const payload={requestId,origin:location.origin,record:{id:recordId,kind:record.kind,title:String(record.title).slice(0,200),owner:String(record.owner).slice(0,100),quantity:Number(record.quantity)||1,notes:String(record.notes||'').slice(0,1800)}};
  return new Promise((resolve,reject)=>{
    const iframe=document.createElement('iframe'),form=document.createElement('form');
    iframe.name='horizon_'+requestId.replace(/-/g,'');iframe.hidden=true;iframe.title='Confirmação de gravação na planilha';
    form.method='POST';form.action=endpoint;form.target=iframe.name;form.hidden=true;
    const input=document.createElement('input');input.type='hidden';input.name='payload';input.value=JSON.stringify(payload);form.append(input);
    let settled=false,timer;
    function cleanup(){clearTimeout(timer);window.removeEventListener('message',receive);form.remove();iframe.remove();}
    function finish(error,response){if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve(response);}
    function receive(event){const message=event.data;if(!trustedResponseOrigin(event.origin)||message?.type!=='horizon:sheets:ack'||message.requestId!==requestId)return;if(message.ok===true&&message.recordId===recordId)finish(null,message);else finish(new Error(message.message||'A planilha recusou a gravação.'));}
    window.addEventListener('message',receive);document.body.append(iframe,form);
    timer=setTimeout(()=>finish(new Error(`Sem confirmação da gravação (${recordId}). Confira a planilha antes de tentar novamente.`)),timeout);
    try{form.submit();}catch(error){finish(new Error('Não foi possível iniciar a conexão com a planilha.'));}
  });
}
