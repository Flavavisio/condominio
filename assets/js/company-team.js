import { supabase } from './supabase.js';

let currentUser = null;
let adminMembership = null;
let company = null;
let observerTimer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = value => String(value || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'CF';

function toast(message, error = false) {
  document.querySelector('.cf-team-toast')?.remove();
  const el = document.createElement('div');
  el.className = `cf-team-toast ${error ? 'error' : ''}`;
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3800);
}

function closeLayer(selector) {
  document.querySelector(selector)?.remove();
}

function layer(className, html) {
  closeLayer(`.${className}`);
  const root = document.createElement('div');
  root.className = className;
  root.innerHTML = html;
  document.body.append(root);
  root.addEventListener('click', event => {
    if (event.target === root) root.remove();
  });
  root.querySelectorAll('[data-team-close]').forEach(btn => btn.addEventListener('click', () => root.remove()));
  return root;
}

async function resolveAdminCompany() {
  const { data: sessionData } = await supabase.auth.getSession();
  currentUser = sessionData?.session?.user || null;
  adminMembership = null;
  company = null;
  if (!currentUser) return false;

  const { data: access } = await supabase.rpc('get_my_access_context').maybeSingle();
  if (access?.is_super_admin) return false;

  const { data: context, error } = await supabase.rpc('get_my_company_admin_context').maybeSingle();
  if (error || !context?.company_id) return false;

  adminMembership = {
    company_id: context.company_id,
    user_id: currentUser.id,
    role: context.member_role,
    status: context.member_status
  };

  company = {
    id: context.company_id,
    name: context.company_name,
    label: context.company_label || context.company_name
  };

  return true;
}

function injectTeamNav() {
  if (!company || !adminMembership) {
    document.querySelector('.cf-team-nav')?.remove();
    return;
  }

  const nav = document.querySelector('.sidebar nav');
  if (!nav || nav.querySelector('.cf-team-nav')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item cf-team-nav';
  btn.innerHTML = '<span>♙</span>Equipa';
  btn.addEventListener('click', openTeam);

  const dashboard = [...nav.querySelectorAll('.nav-item')].find(item => item.textContent.includes('Dashboard'));
  if (dashboard?.nextSibling) nav.insertBefore(btn, dashboard.nextSibling);
  else nav.append(btn);
}

function injectDashboardShortcut() {
  if (!company || !adminMembership) return;
  if (document.querySelector('.cf-team-dashboard-shortcut')) return;

  const title = document.querySelector('.topbar h1')?.textContent?.trim();
  if (title !== 'Dashboard') return;

  const kpis = document.querySelector('.main .kpi-grid');
  if (!kpis) return;

  const card = document.createElement('section');
  card.className = 'command-card cf-team-dashboard-shortcut';
  card.innerHTML = `
    <div>
      <span class="eyebrow">GESTÃO DA EQUIPA</span>
      <h2>Gestores e funcionários</h2>
      <p>Crie gestores, funcionários e atribua a cada um os condomínios pelos quais fica responsável.</p>
    </div>
    <div class="command-actions">
      <button class="light-btn" type="button" data-team-dashboard-open>Gerir equipa</button>
    </div>`;
  card.querySelector('[data-team-dashboard-open]')?.addEventListener('click', openTeam);
  kpis.insertAdjacentElement('afterend', card);
}

async function loadTeamContext() {
  if (!company) {
    const ok = await resolveAdminCompany();
    if (!ok) throw new Error('A conta atual não é Administrador da Empresa Gestora.');
  }

  const [{ data: members, error: memberError }, { data: condos, error: condoError }] = await Promise.all([
    supabase.rpc('list_company_users', { p_company_id: company.id }),
    supabase.from('condominiums').select('id,name,address,city,status').eq('company_id', company.id).order('name')
  ]);
  if (memberError) throw memberError;
  if (condoError) throw condoError;

  let assignments = [];
  const condoIds = (condos || []).map(c => c.id);
  if (condoIds.length) {
    const { data, error } = await supabase
      .from('condominium_staff_assignments')
      .select('id,condominium_id,user_id,status')
      .in('condominium_id', condoIds)
      .eq('status', 'active');
    if (error) throw error;
    assignments = data || [];
  }
  return { members: members || [], condos: condos || [], assignments };
}

function roleLabel(role) {
  return ({ admin: 'Administrador', manager: 'Gestor', staff: 'Funcionário' })[role] || role;
}

function teamCard(member, assignments) {
  const ownAssignments = assignments.filter(a => a.user_id === member.user_id);
  const isAdmin = member.role === 'admin';
  const statusLabel = member.status === 'active' ? 'Ativo' : member.status === 'blocked' ? 'Bloqueado' : 'Pendente';
  return `<article class="cf-team-card" data-team-user="${member.user_id}">
    <div class="cf-team-avatar">${esc(initials(member.full_name || member.email))}</div>
    <div class="cf-team-person"><strong>${esc(member.full_name || member.email)}</strong><span>${esc(member.email)}</span><small>${esc(roleLabel(member.role))}</small></div>
    <div class="cf-team-access">
      <span class="cf-team-status ${esc(member.status)}">${esc(statusLabel)}</span>
      ${isAdmin ? '<strong>Acesso a toda a carteira</strong>' : `<strong>${ownAssignments.length} condomínio(s) atribuído(s)</strong>`}
    </div>
    <div class="cf-team-actions">
      ${!isAdmin && member.status === 'active' ? `<button class="cf-team-secondary" data-team-assign="${member.user_id}">Gerir condomínios</button>` : ''}
    </div>
  </article>`;
}

async function openTeam() {
  try {
    if (!company || !adminMembership) {
      const ok = await resolveAdminCompany();
      if (!ok) return toast('Apenas o Administrador da Empresa Gestora pode gerir a equipa.', true);
    }

    const ctx = await loadTeamContext();
    const root = layer('cf-team-overlay', `
      <section class="cf-team-page">
        <header class="cf-team-head">
          <div><span>EMPRESA GESTORA</span><h2>Equipa</h2><p>${esc(company.label || company.name)} · Gestores, funcionários e condomínios atribuídos.</p></div>
          <div class="cf-team-head-actions"><button class="cf-team-primary" data-team-invite>＋ Novo gestor / funcionário</button><button class="cf-team-close" data-team-close>✕</button></div>
        </header>
        <div class="cf-team-kpis">
          <div><strong>${ctx.members.length}</strong><span>Utilizadores</span></div>
          <div><strong>${ctx.members.filter(m => m.role === 'manager' && m.status === 'active').length}</strong><span>Gestores ativos</span></div>
          <div><strong>${ctx.members.filter(m => m.role === 'staff' && m.status === 'active').length}</strong><span>Funcionários ativos</span></div>
          <div><strong>${ctx.condos.length}</strong><span>Condomínios</span></div>
        </div>
        <div class="cf-team-body">
          <div class="cf-team-section-title"><div><h3>Equipa da empresa</h3><p>O Administrador vê toda a carteira. Cada Gestor ou Funcionário vê apenas os condomínios que lhe forem atribuídos.</p></div></div>
          <div class="cf-team-list">${ctx.members.length ? ctx.members.map(m => teamCard(m, ctx.assignments)).join('') : '<div class="cf-team-empty">Ainda não existem colaboradores.</div>'}</div>
        </div>
      </section>`);

    root.querySelector('[data-team-invite]')?.addEventListener('click', openInvite);
    root.querySelectorAll('[data-team-assign]').forEach(btn => btn.addEventListener('click', () => {
      const member = ctx.members.find(m => m.user_id === btn.dataset.teamAssign);
      if (member) openAssignments(member, ctx);
    }));
  } catch (error) {
    toast(error.message || 'Não foi possível abrir a equipa.', true);
  }
}

function openInvite() {
  const root = layer('cf-team-modal-backdrop', `
    <section class="cf-team-modal">
      <header><div><span>EQUIPA</span><h2>Novo gestor / funcionário</h2><p>O utilizador recebe um convite por email e fica associado à sua empresa.</p></div><button data-team-close>✕</button></header>
      <form id="cfTeamInviteForm" class="cf-team-form">
        <label>Nome completo<input name="fullName" required placeholder="João Silva"></label>
        <label>Email<input name="email" type="email" required placeholder="joao@empresa.pt"></label>
        <label class="wide">Função<select name="role"><option value="manager">Gestor</option><option value="staff">Funcionário</option></select></label>
        <div class="cf-team-note wide">Depois de criar o utilizador, poderá escolher exatamente quais os condomínios que ficam atribuídos a esta pessoa.</div>
        <div class="cf-team-form-actions wide"><button type="button" class="cf-team-secondary" data-team-close>Cancelar</button><button type="submit" class="cf-team-primary">Criar / convidar</button></div>
      </form>
    </section>`);

  root.querySelector('#cfTeamInviteForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A criar…';
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        email: String(values.email || '').trim().toLowerCase(),
        fullName: String(values.fullName || '').trim(),
        companyId: company.id,
        companyRole: values.role
      }
    });
    if (error || data?.error) {
      button.disabled = false;
      button.textContent = 'Criar / convidar';
      return toast(data?.error || error?.message || 'Não foi possível criar o colaborador.', true);
    }
    root.remove();
    toast(data?.invited ? 'Convite enviado. O colaborador foi associado à empresa.' : 'Utilizador existente associado à empresa.');
    await openTeam();
  });
}

function openAssignments(member, ctx) {
  const assigned = new Set(ctx.assignments.filter(a => a.user_id === member.user_id && a.status === 'active').map(a => a.condominium_id));
  const root = layer('cf-team-modal-backdrop', `
    <section class="cf-team-modal cf-team-modal-wide">
      <header><div><span>CARTEIRA</span><h2>Atribuir condomínios</h2><p>${esc(member.full_name || member.email)} · ${esc(roleLabel(member.role))}</p></div><button data-team-close>✕</button></header>
      <form id="cfTeamAssignmentsForm" class="cf-team-assignment-form">
        <div class="cf-team-assignment-list">
          ${ctx.condos.length ? ctx.condos.map(condo => `<label class="cf-team-condo-option"><input type="checkbox" name="condominium" value="${condo.id}" ${assigned.has(condo.id) ? 'checked' : ''}><span><strong>${esc(condo.name)}</strong><small>${esc([condo.address, condo.city].filter(Boolean).join(' · ') || 'Sem morada')}</small></span><b>${assigned.has(condo.id) ? 'Atribuído' : 'Disponível'}</b></label>`).join('') : '<div class="cf-team-empty">A empresa ainda não tem condomínios criados.</div>'}
        </div>
        <div class="cf-team-form-actions"><button type="button" class="cf-team-secondary" data-team-close>Cancelar</button><button type="submit" class="cf-team-primary">Guardar atribuições</button></div>
      </form>
    </section>`);

  root.querySelector('#cfTeamAssignmentsForm').addEventListener('submit', async event => {
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
    toast(`${selected.length} condomínio(s) atribuído(s).`);
    await openTeam();
  });
}

function scheduleInject() {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    injectTeamNav();
    injectDashboardShortcut();
  }, 80);
}

async function initialize() {
  await resolveAdminCompany();
  scheduleInject();
}

window.CondominioCompanyTeam = {
  open: openTeam,
  refresh: initialize
};

const observer = new MutationObserver(scheduleInject);
observer.observe(document.documentElement, { childList: true, subtree: true });

supabase.auth.onAuthStateChange(() => setTimeout(initialize, 120));
window.addEventListener('focus', () => setTimeout(initialize, 80));
initialize();
