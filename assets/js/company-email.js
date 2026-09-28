import {supabase} from './supabase.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(companyId,action,config){
 const {data,error}=await supabase.functions.invoke('company-email',{body:{companyId,action,config}});
 if(error){let message;try{message=(await error.context.json()).error;}catch{}throw new Error(message||'Não foi possível contactar o serviço de email.');}
 if(data?.error)throw new Error(data.error);return data;
}
export async function openCompanyEmail(company){
 document.querySelector('#companyEmailOverlay')?.remove();
 const node=document.createElement('div');node.id='companyEmailOverlay';node.className='admin-overlay';
 node.innerHTML=`<section class="admin-modal" style="width:min(720px,96vw);max-height:90vh;overflow:auto"><header class="admin-modal-head"><h2>Email da empresa</h2><button type="button" class="admin-close" data-close aria-label="Fechar">✕</button></header><div style="padding:24px" data-content>A carregar configuração…</div></section>`;
 document.body.append(node);node.querySelector('[data-close]').onclick=()=>node.remove();node.onclick=e=>{if(e.target===node)node.remove();};
 const content=node.querySelector('[data-content]');
 try{
  const result=await call(company.id,'get'),c=result.config||{host:'',port:587,user:'',name:company.label||company.name,from:company.email||'',replyTo:company.email||''};
  const field=(name,label,type='text')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(c[name])}" required maxlength="254" autocomplete="off"></label>`;
  content.innerHTML=`<p>Os convites e emails aos funcionários e condóminos são enviados pelo SMTP da sua empresa. As comunicações da Condomia ao administrador continuam a usar o remetente da plataforma.</p><p role="status" data-status>${result.state?.verified_at?'SMTP validado':'SMTP por configurar ou validar'}${result.state?.last_error?' · Existe uma falha de envio. Verifique a configuração e repita o teste.':''}</p><p>${result.pending} emails pendentes · ${result.review} envios que necessitam de revisão. Os pendentes aguardam um SMTP validado; os envios de entrega incerta não são repetidos automaticamente.</p><form class="form-grid">${field('host','Servidor SMTP')}<label>Porta e segurança<select name="port"><option value="465">465 — TLS</option><option value="587">587 — STARTTLS</option><option value="2525">2525 — STARTTLS</option></select></label>${field('user','Utilizador SMTP')}<label>Palavra-passe SMTP<input name="password" type="password" autocomplete="new-password" maxlength="1024" ${c.hasPassword?'':'required'} placeholder="${c.hasPassword?'Deixe vazio para manter a palavra-passe':'Palavra-passe ou palavra-passe de aplicação'}"></label>${field('name','Nome do remetente')}${field('from','Email do remetente','email')}${field('replyTo','Responder para','email')}<p class="wide">Ao guardar, é necessário repetir o teste. O email de teste é enviado apenas para o endereço da sua conta de administrador.</p><p class="wide" role="alert" data-message></p><div class="modal-actions wide"><button type="submit" class="primary-btn">Guardar configuração</button><button type="button" class="ghost-btn" data-test ${result.config?'':'disabled'}>Testar envio</button></div></form>`;
  const form=node.querySelector('form'),message=node.querySelector('[data-message]'),test=node.querySelector('[data-test]'),status=node.querySelector('[data-status]');form.elements.port.value=String(c.port);
  let dirty=false,busy=false;
  form.oninput=()=>{dirty=true;test.disabled=true;};
  async function run(fn){if(busy)return;busy=true;for(const b of form.querySelectorAll('button'))b.disabled=true;message.textContent='A processar…';try{await fn();}catch(e){message.textContent=e.message;}finally{busy=false;form.querySelector('[type=submit]').disabled=false;test.disabled=dirty;}}
  form.onsubmit=e=>{e.preventDefault();run(async()=>{const v=Object.fromEntries(new FormData(form));v.port=Number(v.port);await call(company.id,'save',v);form.elements.password.value='';form.elements.password.required=false;form.elements.password.placeholder='Deixe vazio para manter a palavra-passe';dirty=false;status.textContent='Configuração guardada — teste necessário';message.textContent='Agora clique em Testar envio para validar e ativar o SMTP.';});};
  test.onclick=()=>run(async()=>{const r=await call(company.id,'test');status.textContent='SMTP validado';message.textContent=r.message;});
 }catch(e){content.textContent=e.message;}
}
