const decode=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function post(route,data){
 const res=await fetch('/central/api/passkey/'+route,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 const result=await res.json();if(!res.ok)throw Error(result.error||'Falha de autenticação');return result;
}
export async function enrollOwner(key){
 const {options,ceremony}=await post('register/options',{key});
 const publicKey={...options,challenge:decode(options.challenge),user:{...options.user,id:decode(options.user.id)},excludeCredentials:(options.excludeCredentials||[]).map(x=>({...x,id:decode(x.id)}))};
 const credential=await navigator.credentials.create({publicKey});
 if(!credential?.toJSON)throw Error('Use a versão atual do Chrome Android');
 return post('register/verify',{key,ceremony,response:credential.toJSON()});
}
export async function loginOwner(){
 const {options,ceremony}=await post('login/options',{});
 const publicKey={...options,challenge:decode(options.challenge),allowCredentials:(options.allowCredentials||[]).map(x=>({...x,id:decode(x.id)}))};
 const credential=await navigator.credentials.get({publicKey});
 if(!credential?.toJSON)throw Error('Use a versão atual do Chrome Android');
 return post('login/verify',{ceremony,response:credential.toJSON()});
}
