import { supabase } from './supabase.js';

let companiesCache = [];
let timer = null;

const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(Number(v||0));
const initials = v => String(v||'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'CF';

function isSuperScreen(){
  return [...document.querySelectorAll('.topbar .eyebrow, .topbar span')].some(el=>el.textContent?.trim().toLowerCase()==='super admin');
}

function toast(message,error=false){
  document.querySelector('.cf-sa-failsafe-toast')?.remove();
  const el=document.createElement('div');
  el.className=`admin-toast cf-sa-failsafe-toast ${error?'error':'success'}`;
  el.textContent=message;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3500);
}

function closeOverlay(){document.querySelector('#cfSaFailsafeOverlay')?.remove();}
function overlay(html){
  closeOverlay();
  const el=document.createElement('div');
  el.id='cfSaFailsafeOverlay';
  el.className='admin-overlay';
  el.innerHTML=html;
  document.body.appendChild(el);
  el.querySelectorAll('[data-sa-close]').forEach(b=>b.addEventListener('click',closeOverlay));
  el.addEventListener('click',e=>{if(e.target===el)closeOverlay();});
  return el;
}

async function loadCompanies(force=false){
  if(companiesCache.length&&!force) return companiesCache;
  const {data,error}=await supabase.from('companies').select('*').order('created_at',{ascending:false});
  if(error) throw error;
  companiesCache=data||[];
  return companiesCache;
}

function openLicenses(companyId=null){
  const api=window.CondominioSuperAdminLicenses;
  if(api?.open) return api.open(companyId);
  toast('O módulo de licenças ainda está a carregar. Tente novamente.',true);
}

async function openUsers(){
  try{
    const [companiesResult,usersResult]=await Promise.all([loadCompanies(true),supabase.rpc('list_pending_users')]);
    if(usersResult.error) throw usersResult.error;
    const users=usersResult.data||[];
    const options=companiesResult.map(c=>`<option value="${c.id}">${esc(c.label||c.name)}</option>`).join('');
    const root=overlay(`<section class="admin-modal admin-modal-wide"><header class="admin-modal-head"><div><span class="admin-eyebrow">SUPER ADMIN</span><h2>Utilizadores</h2><p>Contas a aguardar associação a uma empresa.</p></div><button class="admin-close" data-sa-close>✕</button></header><div class="admin-modal-body"><div class="admin-summary-strip"><strong>${users.length}</strong><span>conta(s) pendente(s)</span></div><div class="admin-pending-list">${users.length?users.map(u=>`<article class="admin-pending-card" data-user="${u.user_id}"><div class="admin-user-avatar">${esc(initials(u.full_name||u.email))}</div><div class="admin-pending-info"><strong>${esc(u.full_name||u.email)}</strong><span>${esc(u.email)}</span></div><div class="admin-activation-controls"><select data-company><option value="">Escolher empresa…</option>${options}</select><select data-role><option value="admin">Administrador</option><option value="manager">Gestor</option><option value="staff">Funcionário</option></select><button class="admin-primary" data-activate>Ativar</button></div></article>`).join(''):'<div class="admin-empty"><strong>Sem contas pendentes</strong><span>Todas as contas já têm acesso atribuído.</span></div>'}</div></div></section>`);
    root.querySelectorAll('[data-activate]').forEach(btn=>btn.addEventListener('click',async()=>{
      const card=btn.closest('[data-user]'); const companyId=card.querySelector('[data-company]').value; const role=card.querySelector('[data-role]').value;
      if(!companyId) return toast('Escolha uma empresa.',true);
      btn.disabled=true;
      const {error}=await supabase.rpc('activate_company_user',{p_user_id:card.dataset.user,p_company_id:companyId,p_role:role});
      if(error){btn.disabled=false;return toast(error.message,true);} toast('Conta ativada.'); closeOverlay(); openUsers();
    }));
  }catch(error){toast(error.message||'Não foi possível abrir utilizadores.',true);}
}

function memberRow(m){
  const labels={admin:'Administrador',manager:'Gestor',staff:'Funcionário'};
  return `<div class="admin-member-row" data-member="${m.member_id}"><div class="admin-user-avatar small">${esc(initials(m.full_name||m.email))}</div><div class="admin-member-info"><strong>${esc(m.full_name||m.email)}</strong><span>${esc(m.email)}</span></div><select data-role>${['admin','manager','staff'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${labels[r]}</option>`).join('')}</select><select data-status><option value="active" ${m.status==='active'?'selected':''}>Ativo</option><option value="blocked" ${m.status==='blocked'?'selected':''}>Bloqueado</option><option value="pending" ${m.status==='pending'?'selected':''}>Pendente</option></select><button class="admin-mini" data-save>Guardar</button><button class="admin-mini danger" data-remove>Remover</button></div>`;
}

async function openCompany(companyId){
  try{
    const [{data:company,error:companyError},{data:members,error:membersError},countResult]=await Promise.all([
      supabase.from('companies').select('*').eq('id',companyId).maybeSingle(),
      supabase.rpc('list_company_users',{p_company_id:companyId}),
      supabase.from('condominiums').select('id',{count:'exact',head:true}).eq('company_id',companyId)
    ]);
    if(companyError||!company) throw companyError||new Error('Empresa não encontrada.');
    if(membersError) throw membersError;
    const list=members||[];
    const root=overlay(`<section class="admin-modal admin-company-modal"><header class="admin-modal-head company-head" style="--company-brand:${esc(company.brand_color||'#3768f5')}"><div class="admin-logo-preview large fallback" style="--company-brand:${esc(company.brand_color||'#3768f5')}">${esc(initials(company.label||company.name))}</div><div class="grow"><span class="admin-eyebrow">EMPRESA GESTORA</span><h2>${esc(company.label||company.name)}</h2><p>${esc(company.name)} · ${esc(company.plan||'Starter')}</p></div><span class="admin-status ${esc(company.status)}">${company.status==='active'?'Ativa':esc(company.status)}</span><button class="admin-close" data-sa-close>✕</button></header><div class="admin-company-kpis"><div><strong>${countResult.count||0}</strong><span>Condomínios</span></div><div><strong>${list.length}</strong><span>Utilizadores</span></div><div><strong>${money(company.monthly_fee)}</strong><span>Mensalidade</span></div><div><strong>${esc(company.plan||'Starter')}</strong><span>Plano</span></div></div><div class="admin-modal-body admin-company-grid">
      <section class="admin-card"><div class="admin-section-head"><div><h3>Dados da empresa</h3><p>Informação comercial, plano e contrato.</p></div></div><form id="cfSaCompanyForm" class="admin-form-grid"><label>Nome legal<input name="name" value="${esc(company.name||'')}" required></label><label>Marca / label<input name="label" value="${esc(company.label||'')}" required></label><label>NIF<input name="nif" value="${esc(company.nif||'')}"></label><label>Email<input name="email" type="email" value="${esc(company.email||'')}"></label><label>Telefone<input name="phone" value="${esc(company.phone||'')}"></label><label>Plano<select name="plan">${['Starter','Pro','Business','Enterprise'].map(p=>`<option ${company.plan===p?'selected':''}>${p}</option>`).join('')}</select></label><label>Mensalidade (€)<input name="monthly_fee" type="number" step="0.01" value="${Number(company.monthly_fee||0)}"></label><label>Estado<select name="status"><option value="active" ${company.status==='active'?'selected':''}>Ativa</option><option value="suspended" ${company.status==='suspended'?'selected':''}>Suspensa</option><option value="cancelled" ${company.status==='cancelled'?'selected':''}>Cancelada</option></select></label><label>Início contrato<input name="contract_start" type="date" value="${esc(company.contract_start||'')}"></label><label>Fim contrato<input name="contract_end" type="date" value="${esc(company.contract_end||'')}"></label><label class="wide">Notas<textarea name="notes" rows="3">${esc(company.notes||'')}</textarea></label><div class="admin-form-actions wide"><button class="admin-primary" type="submit">Guardar alterações</button></div></form></section>
      <section class="admin-card"><div class="admin-section-head"><div><h3>White-label</h3><p>Marca exclusiva desta gestora.</p></div></div><label class="admin-field">Cor principal<input id="cfSaBrandColor" type="color" value="${esc(company.brand_color||'#3768f5')}"></label><label class="admin-upload-box">Logótipo<input id="cfSaLogo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><span>PNG, JPG, WEBP ou SVG · máximo 5 MB</span></label><div class="admin-inline-actions"><button class="admin-primary" id="cfSaSaveBrand" type="button">Guardar branding</button>${company.logo_url?'<button class="admin-secondary danger-text" id="cfSaRemoveLogo" type="button">Remover logótipo</button>':''}</div></section>
      <section class="admin-card wide-card"><div class="admin-section-head"><div><h3>Utilizadores da empresa</h3><p>Administradores, gestores e funcionários.</p></div><button class="admin-secondary" id="cfSaCompanyLicenses" type="button">Gerir licenças</button></div><form id="cfSaInvite" class="admin-invite-form"><input name="fullName" placeholder="Nome completo"><input name="email" type="email" required placeholder="email@empresa.pt"><select name="role"><option value="admin">Administrador</option><option value="manager">Gestor</option><option value="staff">Funcionário</option></select><button class="admin-primary" type="submit">Convidar</button></form><div class="admin-members-list">${list.length?list.map(memberRow).join(''):'<div class="admin-empty compact"><strong>Sem utilizadores</strong><span>Convide o primeiro administrador.</span></div>'}</div></section>
    </div></section>`);

    root.querySelector('#cfSaCompanyLicenses')?.addEventListener('click',()=>openLicenses(company.id));
    root.querySelector('#cfSaCompanyForm')?.addEventListener('submit',async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));values.monthly_fee=Number(values.monthly_fee||0);values.contract_start=values.contract_start||null;values.contract_end=values.contract_end||null;const {error}=await supabase.from('companies').update(values).eq('id',company.id);if(error)return toast(error.message,true);companiesCache=[];toast('Empresa atualizada.');closeOverlay();setTimeout(()=>location.reload(),350);});
    root.querySelector('#cfSaInvite')?.addEventListener('submit',async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));const result=await supabase.functions.invoke('invite-member',{body:{email:values.email,fullName:values.fullName,companyId:company.id,companyRole:values.role}});if(result.error||result.data?.error)return toast(result.data?.error||result.error?.message||'Erro ao convidar.',true);toast('Utilizador associado/convidado.');closeOverlay();openCompany(company.id);});
    root.querySelectorAll('[data-save]').forEach(btn=>btn.addEventListener('click',async()=>{const row=btn.closest('[data-member]');const {error}=await supabase.from('company_members').update({role:row.querySelector('[data-role]').value,status:row.querySelector('[data-status]').value}).eq('id',row.dataset.member);if(error)return toast(error.message,true);toast('Acesso atualizado.');}));
    root.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',async()=>{const row=btn.closest('[data-member]');if(!confirm('Remover este utilizador da empresa?'))return;const {error}=await supabase.from('company_members').delete().eq('id',row.dataset.member);if(error)return toast(error.message,true);toast('Utilizador removido.');closeOverlay();openCompany(company.id);}));
    root.querySelector('#cfSaSaveBrand')?.addEventListener('click',async()=>{const color=root.querySelector('#cfSaBrandColor').value;const file=root.querySelector('#cfSaLogo').files?.[0]||null;if(file&&file.size>5*1024*1024)return toast('O logótipo não pode ultrapassar 5 MB.',true);let logoUrl=company.logo_url||null;if(file){const path=`${company.id}/logo`;const {error:upErr}=await supabase.storage.from('company-branding').upload(path,file,{upsert:true,contentType:file.type,cacheControl:'3600'});if(upErr)return toast(upErr.message,true);const {data:pub}=supabase.storage.from('company-branding').getPublicUrl(path);logoUrl=`${pub.publicUrl}?v=${Date.now()}`;}const {error}=await supabase.from('companies').update({brand_color:color,logo_url:logoUrl}).eq('id',company.id);if(error)return toast(error.message,true);companiesCache=[];toast('Branding atualizado.');closeOverlay();setTimeout(()=>location.reload(),350);});
    root.querySelector('#cfSaRemoveLogo')?.addEventListener('click',async()=>{await supabase.storage.from('company-branding').remove([`${company.id}/logo`]);const {error}=await supabase.from('companies').update({logo_url:null}).eq('id',company.id);if(error)return toast(error.message,true);toast('Logótipo removido.');closeOverlay();setTimeout(()=>location.reload(),350);});
  }catch(error){toast(error.message||'Não foi possível gerir a empresa.',true);}
}

async function enhanceCompanies(){
  if(!isSuperScreen()) return;
  const title=document.querySelector('.topbar h1')?.textContent?.trim();
  if(title!=='Empresas gestoras') return;
  let companies; try{companies=await loadCompanies();}catch{return;}
  document.querySelectorAll('.panel .rows > .data-row').forEach(row=>{
    if(row.querySelector('[data-sa-manage-company]')) return;
    const label=row.querySelector('div:nth-child(2) strong')?.textContent?.trim();
    const company=companies.find(c=>(c.label||c.name)===label||c.name===label);
    if(!company) return;
    const right=row.querySelector('.right'); if(!right) return;
    const btn=document.createElement('button'); btn.type='button'; btn.className='admin-manage-btn'; btn.dataset.saManageCompany=company.id; btn.textContent='Gerir';
    btn.addEventListener('click',e=>{e.stopPropagation();openCompany(company.id);});
    right.appendChild(btn);
    row.style.cursor='pointer'; row.addEventListener('click',()=>openCompany(company.id));
  });
}

function ensureNav(){
  if(!isSuperScreen()) return;
  document.querySelector('.cf-license-gate')?.remove();
  const nav=document.querySelector('.sidebar nav'); if(!nav) return;
  const companies=[...nav.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Empresas gestoras'));
  if(!nav.querySelector('[data-sa-users-nav]')){const b=document.createElement('button');b.type='button';b.className='nav-item';b.dataset.saUsersNav='1';b.innerHTML='<span>◎</span>Utilizadores';b.addEventListener('click',openUsers);if(companies?.nextSibling)nav.insertBefore(b,companies.nextSibling);else nav.appendChild(b);}
  if(!nav.querySelector('[data-sa-licenses-nav]')){const b=document.createElement('button');b.type='button';b.className='nav-item';b.dataset.saLicensesNav='1';b.innerHTML='<span>◇</span>Licenças';b.addEventListener('click',()=>openLicenses());const users=nav.querySelector('[data-sa-users-nav]');if(users?.nextSibling)nav.insertBefore(b,users.nextSibling);else nav.appendChild(b);}
}

async function tick(){
  clearTimeout(timer);
  timer=setTimeout(async()=>{ensureNav();await enhanceCompanies();},80);
}

const observer=new MutationObserver(tick);
observer.observe(document.documentElement,{childList:true,subtree:true});
setInterval(()=>{ensureNav();enhanceCompanies();},900);
window.addEventListener('focus',tick);
tick();
