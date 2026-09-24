import { supabase } from './supabase.js';

let currentUser = null;
let company = null;
let membership = null;
let timer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = value => String(value || '').split(/\s+/).filter(Boolean).slice(0,2).map(p => p[0]).join('').toUpperCase() || 'CF';
const roleLabel = role => ({admin:'Administrador',manager:'Gestor',staff:'Funcionário'})[role] || role;

function toast(message, error = false) {
  document.querySelector('.cf-team-failsafe-toast')?.remove();
  const el = document.createElement('div');
  el.className = `cf-team-toast cf-team-failsafe-toast ${error ? 'error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function close(selector) { document.querySelector(selector)?.remove(); }
function layer(className, html) {
  close(`.${className}`);
  const root = document.createElement('div');
  root.className = className;
  root.innerHTML = html;
  document.body.appendChild(root);
  root.addEventListener('click', e => { if (e.target === root) root.remove(); });
  root.querySelectorAll('[data-team-core-close]').forEach(btn => btn.addEventListener('click', () => root.remove()));
  return root;
}

async function resolveContext() {
  const { data: sessionData } = await supabase.auth.getSession();
  currentUser = sessionData?.session?.user || null;
  company = null;
  membership = null;
  if (!currentUser) return false;

  const { data: access } = await supabase.rpc('get_my_access_context').maybeSingle();
  if (access?.is_super_admin) return false;

  const { data: member, error } = await supabase
    .from('company_members')
    .select('id,company_id,user_id,role,status')
    .eq('user_id', currentUser.id)
    .eq('status', 'active')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();
  if (error || !member) return false;

  membership = member;
  const { data: companyData } = await supabase
    .from('companies')
    .select('id,name,label,status')
    .eq('id', member.company_id)
    .maybeSingle();
  company = companyData || { id: member.company_id, name: 'Empresa gestora', label: 'Empresa gestora' };
  return true;
}

function ensureNav() {
  if (!company || !membership) return;
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;
  nav.querySelectorAll('.cf-team-nav, .cf-team-core-nav').forEach(node => node.remove());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item cf-team-core-nav';
  btn.innerHTML = '<span>♙</span>Equipa';
  btn.addEventListener('click', openTeam);
  const dashboard = [...nav.querySelectorAll('.nav-item')].find(item => item.textContent.includes('Dashboard'));
  if (dashboard?.nextSibling) nav.insertBefore(btn, dashboard.nextSibling); else nav.appendChild(btn);
}

async function loadTeam() {
  if (!company?.id) throw new Error('Empresa gestora não identificada.');
  const [{ data: members, error: membersError }, { data: condos, error: condosError }] = await Promise.all([
    supabase.rpc('list_company_users', { p_company_id: company.id }),
    supabase.from('condominiums').select('id,name,address,city,status').eq('company_id', company.id).order('name')
  ]);
  if (membersError) throw membersError;
  if (condosError) throw condosError;

  let assignments = [];
  const ids = (condos || []).map(c => c.id);
  if (ids.length) {
    const { data, error } = await supabase.from('condominium_staff_assignments')
      .select('id,condominium_id,user_id,status')
      .in('condominium_id', ids)
      .eq('status', 'active');
    if (error) throw error;
    assignments = data || [];
  }
  return { members: members || [], condos: condos || [], assignments };
}

function memberCard(member, assignments) {
  const assigned = assignments.filter(a => a.user_id === member.user_id && a.status === 'active');
  const admin = member.role === 'admin';
  return `<article class="cf-team-card">
    <div class="cf-team-avatar">${esc(initials(member.full_name || member.email))}</div>
    <div class="cf-team-person"><strong>${esc(member.full_name || member.email)}</strong><span>${esc(member.email || '')}</span><small>${esc(roleLabel(member.role))}</small></div>
    <div class="cf-team-access"><span class="cf-team-status ${esc(member.status || 'active')}">${member.status === 'active' ? 'Ativo' : esc(member.status || 'Pendente')}</span><strong>${admin ? 'Acesso a toda a carteira' : `${assigned.length} condomínio(s) atribuído(s)`}</strong></div>
    <div class="cf-team-actions">${!admin && member.status === 'active' ? `<button class="cf-team-secondary" data-team-core-assign="${member.user_id}">Gerir condomínios</button>` : ''}</div>
  </article>`;
}

async function openTeam() {
  try {
    if (!company || !membership) {
      const ok = await resolveContext();
      if (!ok) return toast('Apenas o Administrador da Empresa Gestora pode gerir a equipa.', true);
    }
    const ctx = await loadTeam();
    const root = layer('cf-team-core-overlay', `<section class="cf-team-page">
      <header class="cf-team-head"><div><span>EMPRESA GESTORA</span><h2>Equipa</h2><p>${esc(company.label || company.name)} · Crie gestores e atribua-lhes os condomínios que ficam à sua responsabilidade.</p></div><div class="cf-team-head-actions"><button class="cf-team-primary" data-team-core-invite>＋ Novo gestor / funcionário</button><button class="cf-team-close" data-team-core-close>✕</button></div></header>
      <div class="cf-team-kpis"><div><strong>${ctx.members.length}</strong><span>Utilizadores</span></div><div><strong>${ctx.members.filter(m => m.role === 'manager' && m.status === 'active').length}</strong><span>Gestores</span></div><div><strong>${ctx.members.filter(m => m.role === 'staff' && m.status === 'active').length}</strong><span>Funcionários</span></div><div><strong>${ctx.condos.length}</strong><span>Condomínios</span></div></div>
      <div class="cf-team-body"><div class="cf-team-section-title"><div><h3>Equipa da empresa</h3><p>O Administrador vê toda a carteira. Cada Gestor/Funcionário vê apenas os condomínios que lhe forem atribuídos.</p></div></div><div class="cf-team-list">${ctx.members.length ? ctx.members.map(m => memberCard(m, ctx.assignments)).join('') : '<div class="cf-team-empty">Ainda não existem colaboradores.</div>'}</div></div>
    </section>`);

    root.querySelector('[data-team-core-invite]')?.addEventListener('click', () => openInvite());
    root.querySelectorAll('[data-team-core-assign]').forEach(btn => btn.addEventListener('click', () => {
      const member = ctx.members.find(m => m.user_id === btn.dataset.teamCoreAssign);
      if (member) openAssignments(member, ctx);
    }));
  } catch (error) {
    toast(error.message || 'Não foi possível abrir a equipa.', true);
  }
}

function openInvite() {
  const root = layer('cf-team-core-modal', `<section class="cf-team-modal"><header><div><span>EQUIPA</span><h2>Novo gestor / funcionário</h2><p>Crie o colaborador e depois atribua-lhe um ou vários condomínios.</p></div><button data-team-core-close>✕</button></header>
    <form class="cf-team-form" data-team-core-invite-form>
      <label>Nome completo<input name="fullName" required placeholder="João Silva"></label>
      <label>Email<input name="email" type="email" required placeholder="joao@empresa.pt"></label>
      <label class="wide">Função<select name="role"><option value="manager">Gestor</option><option value="staff">Funcionário</option></select></label>
      <div class="cf-team-note wide">O Gestor ficará sem condomínios até o Administrador escolher quais quer atribuir.</div>
      <div class="cf-team-form-actions wide"><button type="button" class="cf-team-secondary" data-team-core-close>Cancelar</button><button type="submit" class="cf-team-primary">Criar / convidar</button></div>
    </form></section>`);

  root.querySelector('[data-team-core-invite-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A criar…';
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const { data, error } = await supabase.functions.invoke('invite-member', { body: {
      email: String(values.email || '').trim().toLowerCase(),
      fullName: String(values.fullName || '').trim(),
      companyId: company.id,
      companyRole: values.role
    }});
    if (error || data?.error) {
      button.disabled = false;
      button.textContent = 'Criar / convidar';
      return toast(data?.error || error?.message || 'Não foi possível criar o colaborador.', true);
    }
    root.remove();
    toast(values.role === 'manager' ? 'Gestor criado. Agora atribua-lhe os condomínios.' : 'Funcionário criado. Agora pode atribuir condomínios.');
    await openTeam();
  });
}

function openAssignments(member, ctx) {
  const assigned = new Set(ctx.assignments.filter(a => a.user_id === member.user_id && a.status === 'active').map(a => a.condominium_id));
  const root = layer('cf-team-core-modal', `<section class="cf-team-modal cf-team-modal-wide"><header><div><span>CARTEIRA</span><h2>Atribuir condomínios</h2><p>${esc(member.full_name || member.email)} · ${esc(roleLabel(member.role))}</p></div><button data-team-core-close>✕</button></header>
    <form class="cf-team-assignment-form" data-team-core-assign-form><div class="cf-team-assignment-list">${ctx.condos.length ? ctx.condos.map(condo => `<label class="cf-team-condo-option"><input type="checkbox" name="condominium" value="${condo.id}" ${assigned.has(condo.id) ? 'checked' : ''}><span><strong>${esc(condo.name)}</strong><small>${esc([condo.address,condo.city].filter(Boolean).join(' · ') || 'Sem morada')}</small></span><b>${assigned.has(condo.id) ? 'Atribuído' : 'Disponível'}</b></label>`).join('') : '<div class="cf-team-empty">Ainda não existem condomínios nesta empresa.</div>'}</div><div class="cf-team-form-actions"><button type="button" class="cf-team-secondary" data-team-core-close>Cancelar</button><button type="submit" class="cf-team-primary">Guardar atribuições</button></div></form>
  </section>`);

  root.querySelector('[data-team-core-assign-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A guardar…';
    const selected = [...event.currentTarget.querySelectorAll('input[name="condominium"]:checked')].map(input => input.value);
    const { error } = await supabase.rpc('set_company_user_condominiums', {
      p_company_id: company.id,
      p_user_id: member.user_id,
      p_condominium_ids: selected
    });
    if (error) {
      button.disabled = false;
      button.textContent = 'Guardar atribuições';
      return toast(error.message, true);
    }
    root.remove();
    toast(`${selected.length} condomínio(s) atribuído(s) a ${member.full_name || member.email}.`);
    await openTeam();
  });
}

async function refresh() {
  const ok = await resolveContext();
  if (!ok) {
    document.querySelector('.cf-team-core-nav')?.remove();
    return;
  }
  ensureNav();
  clearTimeout(timer);
  timer = setTimeout(ensureNav, 500);
}

window.CondominioCompanyTeam = { open: openTeam, refresh };
const observer = new MutationObserver(() => { if (company && membership) ensureNav(); });
observer.observe(document.documentElement, { childList:true, subtree:true });
supabase.auth.onAuthStateChange(() => setTimeout(refresh, 120));
window.addEventListener('focus', () => setTimeout(refresh, 80));
setInterval(() => { if (company && membership) ensureNav(); }, 1500);
refresh();
