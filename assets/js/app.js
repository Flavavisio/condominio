import { supabase } from './supabase.js';

const app = document.querySelector('#app');

const state = {
  session: null,
  user: null,
  profile: null,
  companies: [],
  condominiums: [],
  loading: true,
  error: '',
  view: 'dashboard'
};

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const money = value => new Intl.NumberFormat('pt-PT', {
  style: 'currency', currency: 'EUR'
}).format(Number(value || 0));

const initials = (value = '') => value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'CF';

function setMessage(message = '', type = 'info') {
  const holder = document.querySelector('#flash');
  if (!holder) return;
  holder.innerHTML = message ? `<div class="flash ${type}">${esc(message)}</div>` : '';
}

async function loadContext() {
  state.loading = true;
  state.error = '';
  render();

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    state.error = sessionError.message;
    state.loading = false;
    render();
    return;
  }

  state.session = sessionData.session;
  state.user = sessionData.session?.user || null;

  if (!state.user) {
    state.profile = null;
    state.companies = [];
    state.condominiums = [];
    state.loading = false;
    render();
    return;
  }

  const [profileResult, companyResult, condoResult] = await Promise.all([
    supabase.from('profiles').select('user_id,full_name,phone,avatar_url,is_super_admin').eq('user_id', state.user.id).maybeSingle(),
    supabase.from('companies').select('id,name,label,nif,email,phone,logo_url,brand_color,plan,monthly_fee,status,contract_start,contract_end,created_at').order('created_at', { ascending: false }),
    supabase.from('condominiums').select('id,company_id,name,address,postal_code,city,fractions_count,status,contract_ref,monthly_value,created_at').order('created_at', { ascending: false })
  ]);

  if (profileResult.error) state.error = profileResult.error.message;
  else state.profile = profileResult.data;

  if (companyResult.error && !state.error) state.error = companyResult.error.message;
  state.companies = companyResult.data || [];

  if (condoResult.error && !state.error) state.error = condoResult.error.message;
  state.condominiums = condoResult.data || [];

  state.loading = false;
  render();
}

function loginView() {
  return `
    <main class="auth-page">
      <section class="auth-brand">
        <div class="brand-mark large">CF</div>
        <span class="eyebrow">CONDOMÍNIO FÁCIL</span>
        <h1>Menos chamadas.<br>Mais transparência.</h1>
        <p>A plataforma operacional para empresas gestoras, condomínios e condóminos.</p>
        <div class="auth-points">
          <span>✓ Multiempresa</span><span>✓ White-label</span><span>✓ Ocorrências</span><span>✓ Livro do edifício</span>
        </div>
      </section>
      <section class="auth-panel">
        <div class="login-card">
          <div class="mobile-brand"><div class="brand-mark">CF</div><strong>Condomínio Fácil</strong></div>
          <span class="eyebrow blue">ACESSO À PLATAFORMA</span>
          <h2>Bem-vindo</h2>
          <p>Utilize a conta criada no Supabase Auth.</p>
          <div id="flash">${state.error ? `<div class="flash error">${esc(state.error)}</div>` : ''}</div>
          <form id="loginForm" class="form-stack">
            <label>Email<input type="email" name="email" autocomplete="email" required placeholder="nome@empresa.pt"></label>
            <label>Palavra-passe<input type="password" name="password" autocomplete="current-password" required placeholder="••••••••"></label>
            <button class="primary-btn" type="submit">Entrar</button>
          </form>
          <small class="auth-note">O acesso é reservado a utilizadores autorizados pela plataforma.</small>
        </div>
      </section>
    </main>`;
}

function navItem(view, label, icon) {
  return `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}"><span>${icon}</span>${label}</button>`;
}

function shell(content) {
  const role = state.profile?.is_super_admin ? 'Super Admin' : 'Utilizador';
  const name = state.profile?.full_name || state.user?.email || 'Utilizador';
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">CF</div><div><strong>Condomínio Fácil</strong><small>GESTÃO SAAS</small></div></div>
        <nav>
          <span class="nav-label">Plataforma</span>
          ${navItem('dashboard', 'Dashboard', '⌂')}
          ${navItem('companies', 'Empresas gestoras', '▦')}
          ${navItem('condominiums', 'Condomínios', '▥')}
        </nav>
        <div class="sidebar-user">
          <div class="avatar">${esc(initials(name))}</div>
          <div><strong>${esc(name)}</strong><small>${esc(role)}</small></div>
          <button id="logoutBtn" title="Terminar sessão">↗</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><span class="eyebrow blue">${esc(role)}</span><h1>${viewTitle()}</h1><p>${viewSubtitle()}</p></div>
          <div class="connection"><span></span> Supabase ligado</div>
        </header>
        <div id="flash">${state.error ? `<div class="flash error">${esc(state.error)}</div>` : ''}</div>
        ${content}
      </main>
    </div>
    ${state.profile?.is_super_admin ? createModalHost() : ''}`;
}

function viewTitle() {
  if (state.view === 'companies') return 'Empresas gestoras';
  if (state.view === 'condominiums') return 'Condomínios';
  return 'Dashboard';
}

function viewSubtitle() {
  if (state.view === 'companies') return 'Clientes SaaS que pagam a plataforma.';
  if (state.view === 'condominiums') return 'Carteira de edifícios por empresa gestora.';
  return 'Visão global da plataforma e operação.';
}

function kpi(label, value, foot, icon) {
  return `<article class="kpi-card"><div><span>${esc(label)}</span><strong>${value}</strong><small>${esc(foot)}</small></div><i>${icon}</i></article>`;
}

function dashboardView() {
  const activeCompanies = state.companies.filter(item => item.status === 'active');
  const activeCondos = state.condominiums.filter(item => item.status === 'active');
  const fractions = state.condominiums.reduce((sum, item) => sum + Number(item.fractions_count || 0), 0);
  const mrr = activeCompanies.reduce((sum, item) => sum + Number(item.monthly_fee || 0), 0);

  return shell(`
    <section class="kpi-grid">
      ${kpi('Empresas gestoras', state.companies.length, `${activeCompanies.length} ativas`, '▦')}
      ${kpi('Condomínios', state.condominiums.length, `${activeCondos.length} ativos`, '▥')}
      ${kpi('Frações', fractions, 'Sob gestão', '▤')}
      ${kpi('MRR SaaS', money(mrr), 'Mensalidades ativas', '€')}
    </section>
    ${state.profile?.is_super_admin ? `
      <section class="command-card">
        <div><span class="eyebrow">CENTRO DE CONTROLO</span><h2>A estrutura Supabase está pronta.</h2><p>Crie a primeira empresa gestora e depois associe os respetivos condomínios.</p></div>
        <button class="light-btn" data-open="company">＋ Nova empresa gestora</button>
      </section>` : ''}
    <section class="two-col">
      <article class="panel">
        <div class="panel-head"><div><h2>Empresas recentes</h2><p>Clientes com acesso à plataforma</p></div><button class="text-btn" data-view="companies">Ver todas →</button></div>
        ${companyRows(state.companies.slice(0, 6))}
      </article>
      <article class="panel">
        <div class="panel-head"><div><h2>Condomínios recentes</h2><p>Últimos edifícios registados</p></div><button class="text-btn" data-view="condominiums">Ver todos →</button></div>
        ${condoRows(state.condominiums.slice(0, 6))}
      </article>
    </section>`);
}

function companyRows(items) {
  if (!items.length) return empty('Ainda não existem empresas gestoras.');
  return `<div class="rows">${items.map(item => `
    <div class="data-row">
      <div class="logo-dot" style="--brand:${esc(item.brand_color || '#3768f5')}">${esc(initials(item.label || item.name))}</div>
      <div><strong>${esc(item.label || item.name)}</strong><small>${esc(item.name)} · ${esc(item.plan)}</small></div>
      <div class="right"><strong>${money(item.monthly_fee)}</strong><span class="status ${esc(item.status)}">${esc(item.status)}</span></div>
    </div>`).join('')}</div>`;
}

function condoRows(items) {
  if (!items.length) return empty('Ainda não existem condomínios.');
  return `<div class="rows">${items.map(item => {
    const company = state.companies.find(company => company.id === item.company_id);
    return `<div class="data-row"><div class="logo-dot condo">▥</div><div><strong>${esc(item.name)}</strong><small>${esc(item.address || item.city || 'Sem morada')} · ${Number(item.fractions_count || 0)} frações</small></div><div class="right"><strong>${esc(company?.label || company?.name || '—')}</strong><span class="status ${esc(item.status)}">${esc(item.status)}</span></div></div>`;
  }).join('')}</div>`;
}

function companiesView() {
  return shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>Empresas gestoras</h2><p>Contratos, branding e plano SaaS.</p></div>${state.profile?.is_super_admin ? '<button class="primary-btn compact" data-open="company">＋ Nova empresa</button>' : ''}</div>
      ${companyRows(state.companies)}
    </section>`);
}

function condominiumsView() {
  return shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>Carteira de condomínios</h2><p>Todos os edifícios visíveis para a sua conta.</p></div>${state.profile?.is_super_admin && state.companies.length ? '<button class="primary-btn compact" data-open="condominium">＋ Novo condomínio</button>' : ''}</div>
      ${condoRows(state.condominiums)}
    </section>`);
}

function empty(text) {
  return `<div class="empty"><div>◇</div><strong>Sem dados</strong><span>${esc(text)}</span></div>`;
}

function createModalHost() {
  return '<div id="modalHost"></div>';
}

function openModal(type) {
  const host = document.querySelector('#modalHost');
  if (!host) return;
  if (type === 'company') {
    host.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><span class="eyebrow blue">SUPER ADMIN</span><h2>Nova empresa gestora</h2></div><button data-close>✕</button></div><form id="companyForm" class="form-grid"><label>Nome legal<input name="name" required></label><label>Label / marca<input name="label" required></label><label>NIF<input name="nif"></label><label>Email<input name="email" type="email"></label><label>Telefone<input name="phone"></label><label>Plano<select name="plan"><option>Starter</option><option>Pro</option><option>Business</option><option>Enterprise</option></select></label><label>Mensalidade (€)<input name="monthly_fee" type="number" step="0.01" value="49.90"></label><label>Cor da marca<input name="brand_color" type="color" value="#3768f5"></label><div class="modal-actions"><button type="button" class="ghost-btn" data-close>Cancelar</button><button class="primary-btn" type="submit">Criar empresa</button></div></form></div></div>`;
  }
  if (type === 'condominium') {
    host.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><span class="eyebrow blue">CARTEIRA</span><h2>Novo condomínio</h2></div><button data-close>✕</button></div><form id="condoForm" class="form-grid"><label>Empresa gestora<select name="company_id" required>${state.companies.map(item => `<option value="${item.id}">${esc(item.label || item.name)}</option>`).join('')}</select></label><label>Nome do condomínio<input name="name" required></label><label class="wide">Morada<input name="address"></label><label>Cidade<input name="city"></label><label>N.º de frações<input name="fractions_count" type="number" min="0" value="0"></label><label>Referência contrato<input name="contract_ref"></label><label>Valor mensal (€)<input name="monthly_value" type="number" step="0.01" value="0"></label><div class="modal-actions"><button type="button" class="ghost-btn" data-close>Cancelar</button><button class="primary-btn" type="submit">Criar condomínio</button></div></form></div></div>`;
  }
  bindModal();
}

function closeModal() {
  const host = document.querySelector('#modalHost');
  if (host) host.innerHTML = '';
}

function bindModal() {
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  document.querySelector('#companyForm')?.addEventListener('submit', createCompany);
  document.querySelector('#condoForm')?.addEventListener('submit', createCondominium);
}

async function createCompany(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.monthly_fee = Number(values.monthly_fee || 0);
  const { error } = await supabase.from('companies').insert(values);
  if (error) return setMessage(error.message, 'error');
  closeModal();
  await loadContext();
}

async function createCondominium(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.fractions_count = Number(values.fractions_count || 0);
  values.monthly_value = Number(values.monthly_value || 0);
  const { error } = await supabase.from('condominiums').insert(values);
  if (error) return setMessage(error.message, 'error');
  closeModal();
  await loadContext();
}

function bind() {
  document.querySelector('#loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('A validar credenciais…');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) setMessage(error.message, 'error');
  });

  document.querySelector('#logoutBtn')?.addEventListener('click', () => supabase.auth.signOut());

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    render();
  }));

  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openModal(button.dataset.open)));
}

function render() {
  if (state.loading) {
    app.innerHTML = '<div class="boot-screen"><div class="boot-mark">CF</div><strong>Condomínio Fácil</strong><span>A sincronizar com Supabase…</span></div>';
    return;
  }

  if (!state.user) app.innerHTML = loginView();
  else if (state.view === 'companies') app.innerHTML = companiesView();
  else if (state.view === 'condominiums') app.innerHTML = condominiumsView();
  else app.innerHTML = dashboardView();

  bind();
}

supabase.auth.onAuthStateChange((_event, session) => {
  const changed = session?.user?.id !== state.user?.id;
  if (changed || (!session && state.user)) loadContext();
});

loadContext();
