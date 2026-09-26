import { supabase } from './supabase.js';

let user = null;
let membership = null;
let company = null;
let uiTimer = null;
let resolving = false;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = value => String(value || '').split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join('').toUpperCase() || 'CF';

function toast(message, error = false) {
  document.querySelector('.cf-team-toast')?.remove();
  const el = document.createElement('div');
  el.className = `cf-team-toast ${error ? 'error' : ''}`;
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

function layer(className, html) {
  document.querySelector(`.${className}`)?.remove();
  const root = document.createElement('div');
  root.className = className;
  root.innerHTML = html;
  document.body.append(root);
  root.addEventListener('click', e => { if (e.target === root) root.remove(); });
  root.querySelectorAll('[data-team-close]').forEach(btn => btn.addEventListener('click', () => root.remove()));
  return root;
}

async function resolveContext() {
  if (resolving) return Boolean(company && membership);
  resolving = true;
  try {
    const { data: authData } = await supabase.auth.getUser();
    user = authData?.user || null;
    membership = null;
    company = null;
    if (!user) return false;

    const { data: access } = await supabase.rpc('get_my_access_context').maybeSingle();
    if (access?.is_super_admin) return false;

    const { data: rows, error } = await supabase
      .from('company_members')
      .select('id,company_id,user_id,role,status')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .eq('status', 'active')
      .limit(1);
    if (error || !rows?.length) return false;

    membership = rows[0];
    const { data: c, error: companyError } = await supabase
      .from('companies')
      .select('id,name,label,status')
      .eq('id', membership.company_id)
      .maybeSingle();
    if (companyError || !c) {
      membership = null;
      return false;
    }
    company = c;
    return true;
  } finally {
    resolving = false;
  }
}

function ensureDashboardShortcut() {
  if (!company || !membership) return;
  const title = document.querySelector('.topbar h1')?.textContent?.trim();
  if (title !== 'Dashboard') return;
  if (document.querySelector('.cf-team-core-shortcut')) return;

  const kpis = document.querySelector('.main .kpi-grid');
  if (!kpis) return;

  const card = document.createElement('section');
  card.className = 'command-card cf-team-core-shortcut';
  card.innerHTML = `
    <div>
      <span class="eyebrow">GESTÃO DA EQUIPA</span>
      <h2>Gestores e funcionários</h2>
      <p>Crie a sua equipa e atribua a cada Gestor ou Funcionário os condomínios pelos quais fica responsável.</p>
    </div>
    <div class="command-actions">
      <button type="button" class="light-btn" data-team-open>Gerir equipa</button>
    </div>`;
  card.querySelector('[data-team-open]').addEventListener('click', openTeam);
  kpis.insertAdjacentElement('afterend', card);
}

function syncUI() {
  ensureDashboardShortcut();
}

async function loadTeam() {
  if (!company && !(await resolveContext())) throw new Error('A conta atual não é Administrador da Empresa Gestora.');

  const [{ data: members, error: membersError }, { data: condos, error: condosError }] = await Promise.all([
    supabase.rpc('list_company_users', { p_company_id: company.id }),
    supabase.from('condominiums').select('id,name,address,city,status').eq('company_id', company.id).order('name')
  ]);
  if (membersError) throw membersError;
  if (condosError) throw condosError;

  const condoIds = (condos || []).map(c => c.id);
  let assignments = [];
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

const roleLabel = role => ({admin:'Administrador',manager:'Gestor',staff:'Funcionário'})[role] || role;

function memberCard(member, assignments) {
  const own = assignments.filter(a => a.user_id === member.user_id);
  const admin = member.role === 'admin';
  return `<article class="cf-team-card">
    <div class="cf-team-avatar">${esc(initials(member.full_name || member.email))}</div>
    <div class="cf-team-person">
      <strong>${esc(member.full_name || member.email)}</strong>
      <span>${esc(member.email || '')}</span>
      <small>${esc(roleLabel(member.role))}</small>
    </div>
    <div class="cf-team-access">
      <span class="cf-team-status ${esc(member.status)}">${esc(member.status === 'active' ? 'Ativo' : member.status)}</span>
      <strong>${admin ? 'Acesso a toda a carteira' : `${own.length} condomínio(s) atribuído(s)`}</strong>
    </div>
    <div class="cf-team-actions">
      ${!admin && member.status === 'active' ? `<button type="button" class="cf-team-secondary" data-team-assign="${member.user_id}">Gerir condomínios</button>` : ''}
    </div>
  </article>`;
}

async function openTeam() {
  try {
    if (!company || !membership) {
      const ok = await resolveContext();
      if (!ok) return toast('Apenas o Administrador da Empresa Gestora pode gerir a equipa.', true);
    }

    const ctx = await loadTeam();
    const root = layer('cf-team-overlay', `
      <section class="cf-team-page">
        <header class="cf-team-head">
          <div><span>EMPRESA GESTORA</span><h2>Equipa</h2><p>${esc(company.label || company.name)} · Gestores, funcionários e condomínios atribuídos.</p></div>
          <div class="cf-team-head-actions"><button type="button" class="cf-team-primary" data-team-invite>＋ Novo gestor / funcionário</button><button type="button" class="cf-team-close" data-team-close>✕</button></div>
        </header>
        <div class="cf-team-kpis">
          <div><strong>${ctx.members.length}</strong><span>Utilizadores</span></div>
          <div><strong>${ctx.members.filter(m=>m.role==='manager'&&m.status==='active').length}</strong><span>Gestores ativos</span></div>
          <div><strong>${ctx.members.filter(m=>m.role==='staff'&&m.status==='active').length}</strong><span>Funcionários ativos</span></div>
          <div><strong>${ctx.condos.length}</strong><span>Condomínios</span></div>
        </div>
        <div class="cf-team-body">
          <div class="cf-team-section-title"><div><h3>Equipa da empresa</h3><p>O Administrador vê toda a carteira. Gestores e Funcionários veem apenas os condomínios que lhes forem atribuídos.</p></div></div>
          <div class="cf-team-list">${ctx.members.length ? ctx.members.map(m=>memberCard(m,ctx.assignments)).join('') : '<div class="cf-team-empty">Ainda não existem colaboradores.</div>'}</div>
        </div>
      </section>`);

    root.querySelector('[data-team-invite]')?.addEventListener('click', openInvite);
    root.querySelectorAll('[data-team-assign]').forEach(btn => btn.addEventListener('click', () => {
      const member = ctx.members.find(m => m.user_id === btn.dataset.teamAssign);
      if (member) openAssignments(member, ctx);
    }));
  } catch (error) {
    console.error('Equipa:', error);
    toast(error.message || 'Não foi possível abrir a equipa.', true);
  }
}

async function edgeErrorMessage(error, data) {
  if (data?.error) return data.error;
  try {
    if (error?.context instanceof Response) {
      const cloned = error.context.clone();
      const payload = await cloned.json();
      if (payload?.error) return payload.error;
    }
  } catch {}
  return error?.message || 'Não foi possível criar o colaborador.';
}

function openInvite() {
  const root = layer('cf-team-modal-backdrop', `
    <section class="cf-team-modal">
      <header><div><span>EQUIPA</span><h2>Novo gestor / funcionário</h2><p>Crie a conta e depois atribua os condomínios pelos quais esta pessoa fica responsável.</p></div><button type="button" data-team-close>✕</button></header>
      <form id="cfTeamCoreInvite" class="cf-team-form">
        <label>Nome completo<input name="fullName" required placeholder="João Silva"></label>
        <label>Email<input name="email" type="email" required placeholder="joao@empresa.pt"></label>
        <label>Password inicial<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></label>
        <label>Função<select name="role"><option value="manager">Gestor</option><option value="staff">Funcionário</option></select></label>
        <div class="cf-team-note wide">A conta é criada diretamente. Entregue o email e a password inicial ao colaborador. O Administrador continua a ser o único perfil que gere a equipa.</div>
        <div class="cf-team-form-actions wide"><button type="button" class="cf-team-secondary" data-team-close>Cancelar</button><button type="submit" class="cf-team-primary">Criar conta</button></div>
      </form>
    </section>`);

  root.querySelector('#cfTeamCoreInvite').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A criar…';
    const v = Object.fromEntries(new FormData(e.currentTarget));

    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        email: String(v.email || '').trim().toLowerCase(),
        fullName: String(v.fullName || '').trim(),
        password: String(v.password || ''),
        companyId: company.id,
        companyRole: v.role
      }
    });

    if (error || data?.error) {
      button.disabled = false;
      button.textContent = 'Criar conta';
      const message = await edgeErrorMessage(error, data);
      return toast(message, true);
    }

    root.remove();
    toast(data?.created ? 'Conta criada e associada à empresa.' : 'O email já existia e foi associado à empresa.');
    await openTeam();
  });
}

function openAssignments(member, ctx) {
  const assigned = new Set(ctx.assignments.filter(a=>a.user_id===member.user_id).map(a=>a.condominium_id));
  const root = layer('cf-team-modal-backdrop', `
    <section class="cf-team-modal cf-team-modal-wide">
      <header><div><span>CARTEIRA</span><h2>Atribuir condomínios</h2><p>${esc(member.full_name || member.email)} · ${esc(roleLabel(member.role))}</p></div><button type="button" data-team-close>✕</button></header>
      <form id="cfTeamCoreAssignments" class="cf-team-assignment-form">
        <div class="cf-team-assignment-list">
          ${ctx.condos.length ? ctx.condos.map(c=>`<label class="cf-team-condo-option"><input type="checkbox" name="condominium" value="${c.id}" ${assigned.has(c.id)?'checked':''}><span><strong>${esc(c.name)}</strong><small>${esc([c.address,c.city].filter(Boolean).join(' · ') || 'Sem morada')}</small></span><b>${assigned.has(c.id)?'Atribuído':'Disponível'}</b></label>`).join('') : '<div class="cf-team-empty">A empresa ainda não tem condomínios.</div>'}
        </div>
        <div class="cf-team-form-actions"><button type="button" class="cf-team-secondary" data-team-close>Cancelar</button><button type="submit" class="cf-team-primary">Guardar atribuições</button></div>
      </form>
    </section>`);

  root.querySelector('#cfTeamCoreAssignments').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A guardar…';
    const selected = [...e.currentTarget.querySelectorAll('input[name="condominium"]:checked')].map(x=>x.value);

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

async function start() {
  await resolveContext();
  syncUI();
  clearInterval(uiTimer);
  uiTimer = setInterval(syncUI, 700);
}

supabase.auth.onAuthStateChange(() => setTimeout(start, 150));
window.addEventListener('focus', () => setTimeout(start, 100));
window.CondominioCompanyTeam = { open: openTeam, refresh: start };
start();
