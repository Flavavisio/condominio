import {supabase} from './supabase.js';
const params=new URLSearchParams(location.search),type=params.get('type'),token=params.get('token_hash');
const form=document.querySelector('#form'),message=document.querySelector('#message');
const reset=params.get('mode')==='recovery';
const passwordFlow=['recovery','invite'].includes(type);
let verified=false;
document.querySelector('#title').textContent=reset?'Recuperar palavra-passe':passwordFlow?'Definir palavra-passe':'Confirmar acesso';
document.querySelector('#intro').textContent=reset?'Indique o email da sua conta.':passwordFlow?'Defina a palavra-passe que pretende utilizar na Condomia.':'Clique no botão para confirmar este pedido.';
if(reset)form.innerHTML='<label>Email<input name="email" type="email" autocomplete="email" required></label><button>Enviar link de recuperação</button>';
else if(token&&['signup','recovery','invite','magiclink','email_change'].includes(type))form.innerHTML=passwordFlow?'<label>Nova palavra-passe<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirmar palavra-passe<input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label><button>Guardar palavra-passe</button>':'<button>Confirmar</button>';
else {message.textContent='Link inválido. Peça um novo email de acesso.';message.className='error';}
form.addEventListener('submit',async event=>{
 event.preventDefault();const data=new FormData(form),button=form.querySelector('button');button.disabled=true;message.textContent='A processar…';message.className='';
 try{
  if(reset){const {error}=await supabase.auth.resetPasswordForEmail(data.get('email'),{redirectTo:new URL('auth.html?mode=recovery',location.href).href});if(error)throw error;message.textContent='Se existir uma conta com este email, receberá um link para recuperar a palavra-passe.';}
  else{
   if(passwordFlow&&data.get('password')!==data.get('confirm'))throw Error('As palavras-passe não coincidem.');
   if(!verified){const {error}=await supabase.auth.verifyOtp({token_hash:token,type});if(error)throw error;verified=true;history.replaceState(null,'',location.pathname);}
   if(passwordFlow){const {error}=await supabase.auth.updateUser({password:data.get('password')});if(error)throw error;}
   message.textContent=passwordFlow?'Palavra-passe guardada. Já pode abrir a aplicação.':'Email confirmado. Já pode abrir a aplicação.';form.replaceChildren();
  }
 }catch(error){message.className='error';message.textContent=error.message||'Não foi possível concluir. Peça um novo link.';}finally{if(button.isConnected)button.disabled=false;}
});
