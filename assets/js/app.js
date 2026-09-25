import * as api from './api.js';
import * as ui from './mockup-ui.js';
import * as governance from './governance.js';

const app = document.querySelector('#app');

const state = {
  session: null,
  user: null,
  profile: null,
  companies: [],
  companyMembers: [],
  condominiums: [],
  fractions: [],
  condominiumMembers: [],
  profiles: [],
  issues: [],
  notices: [],
  documents: [],
  suppliers: [],
  equipment: [],
  maintenance: [],
  obligations: [],
  obligationChecklistItems: [],
  obligationInspections: [],
  assemblies: [], polls: [], pollVotes: [],
  dashboardCompanyId: '',
  dashboardCondoId: '',
  residentCondoId: '',
  searchQuery: '',
  view: 'dashboard',
  condoTab: 'overview',
  selectedCondoId: null,
  authMode: 'login',
  loading: true,
  error: '',
  info: ''
};

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const money = value => new Intl.NumberFormat('pt-PT', {
  style: 'currency', currency: 'EUR'
}).format(Number(value || 0));

const date = value => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : '—';
const dateTime = value => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const initials = (value = '') => value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'CF';

function showError(error) {
  state.error = error?.message || String(error || 'Ocorreu um erro.');
  state.info = '';
  render();
}

function showInfo(message) {
  state.info = message;
  state.error = '';
  render();
}

function currentCompanyMembership(companyId) {
  return state.companyMembers.find(item => item.company_id === companyId && item.user_id === state.user?.id && item.status === 'active');
}

function isSuperAdmin() {
  return Boolean(state.profile?.is_super_admin);
}

function canManageCompany(companyId) {
  if (isSuperAdmin()) return true;
  return ['admin', 'manager'].includes(currentCompanyMembership(companyId)?.role);
}

function canWorkCompany(companyId) {
  if (isSuperAdmin()) return true;
  return ['admin', 'manager', 'staff'].includes(currentCompanyMembership(companyId)?.role);
}

function companyFor(condo) {
  return state.companies.find(item => item.id === condo?.company_id);
}

function selectedCondo() {
  return state.condominiums.find(item => item.id === state.selectedCondoId) || null;
}

function isResidentOnly() {
  if (!state.user || isSuperAdmin()) return false;
  const staff = state.companyMembers.some(item => item.user_id === state.user.id && item.status === 'active');
  const resident = state.condominiumMembers.some(item => item.user_id === state.user.id && item.status === 'active');
  return resident && !staff;
}

function hasAnyAccess() {
  return isSuperAdmin() || state.companyMembers.some(item => item.user_id === state.user?.id && item.status === 'active') || state.condominiumMembers.some(item => item.user_id === state.user?.id && item.status === 'active');
}

function entityProfile(userId) {
  if (userId === state.user?.id) return state.profile;
  return state.profiles.find(item => item.user_id === userId);
}

async function loadContext({ keepView = true } = {}) {
  state.loading = true;
  state.error = '';
  render();
  try {
    const session = await api.getSession();
    state.session = session;
    state.user = session?.user || null;

    if (!state.user) {
      resetWorkspace();
      state.loading = false;
      render();
      return;
    }

    const workspace = await api.loadWorkspace(state.user.id);
    Object.assign(state, workspace);

    if (state.selectedCondoId && !state.condominiums.some(item => item.id === state.selectedCondoId)) {
      state.selectedCondoId = null;
      state.view = 'dashboard';
    }
    if (!keepView) state.view = 'dashboard';
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

function resetWorkspace() {
  state.profile = null;
  state.companies = [];
  state.companyMembers = [];
  state.condominiums = [];
  state.fractions = [];
  state.condominiumMembers = [];
  state.profiles = [];
  state.issues = [];
  state.notices = [];
  state.documents = [];
  state.suppliers = [];
  state.equipment = [];
  state.maintenance = [];
  state.obligations = [];
  state.obligationChecklistItems = [];
  state.obligationInspections = [];
  state.assemblies = []; state.polls = []; state.pollVotes = [];
  state.selectedCondoId = null;
  state.dashboardCompanyId = '';
  state.dashboardCondoId = '';
  state.residentCondoId = '';
  state.searchQuery = '';
  state.view = 'dashboard';
}

function flash() {
  if (!state.error && !state.info) return '<div id="flash"></div>';
  return `<div id="flash"><div class="flash ${state.error ? 'error' : 'success'}">${esc(state.error || state.info)}</div></div>`;
}

function authView() {
  const signup = state.authMode === 'signup';
  return `
    <main class="auth-page">
      <section class="auth-brand">
        <div class="brand-mark large">C</div>
        <span class="eyebrow">CONDOMIA</span><span class="cf-auth-slogan">Condomínio fácil</span>
        <h1>Menos chamadas.<br>Mais transparência.</h1>
        <p>A plataforma operacional para empresas gestoras, condomínios e condóminos.</p>
        <div class="auth-points">
          <span>✓ Multiempresa</span><span>✓ White-label</span><span>✓ Ocorrências</span><span>✓ Livro técnico</span>
        </div>
      </section>
      <section class="auth-panel">
        <div class="login-card">
          <div class="mobile-brand cf-brand">${ui.brand()}</div>
          <span class="eyebrow blue">${signup ? 'CRIAR CONTA' : 'ACESSO À PLATAFORMA'}</span>
          <h2>${signup ? 'Primeiro acesso' : 'Bem-vindo'}</h2>
          <p>${signup ? 'Crie a sua conta. O acesso a empresas e condomínios é atribuído pela administração.' : 'Entre com a sua conta da plataforma.'}</p>
          ${flash()}
          <form id="authForm" class="form-stack">
            ${signup ? '<label>Nome completo<input type="text" name="fullName" autocomplete="name" required placeholder="Nome completo"></label>' : ''}
            <label>Email<input type="email" name="email" autocomplete="email" required placeholder="nome@empresa.pt"></label>
            <label>Palavra-passe<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required placeholder="••••••••"></label>
            <button class="primary-btn" type="submit">${signup ? 'Criar conta' : 'Entrar'}</button>
          </form>
          <button class="auth-switch" id="authSwitch">${signup ? 'Já tenho conta → Entrar' : 'Primeiro acesso → Criar conta'}</button>
          <small class="auth-note">Os privilégios de Super Admin nunca são atribuídos pelo browser.</small>
        </div>
      </section>
    </main>`;
}

function pendingView() {
  const name = state.profile?.full_name || state.user?.email || 'Utilizador';
  return `
    <main class="pending-page">
      <section class="pending-card">
        <div class="brand-mark large">C</div>
        <span class="eyebrow blue">CONTA CRIADA</span>
        <h1>Olá, ${esc(name)}.</h1>
        <p>A sua conta está ativa, mas ainda não foi associada a uma empresa gestora ou condomínio.</p>
        <div class="pending-state"><span></span><div><strong>A aguardar ativação</strong><small>Um administrador precisa de lhe atribuir acesso.</small></div></div>
        ${flash()}
        <div class="pending-actions"><button class="ghost-btn" id="refreshAccess">Verificar novamente</button><button class="primary-btn" id="logoutBtn">Sair</button></div>
      </section>
    </main>`;
}

function navItem(view, label, icon) {
  return `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}"><span>${icon}</span>${label}</button>`;
}

function viewTitle() {
  if (state.view === 'companies') return 'Empresas gestoras';
  if (state.view === 'condominiums') return 'Condomínios';
  if (state.view === 'operations') return 'Centro operacional';
  if (state.view === 'obligations') return 'Obrigações';
  if (state.view === 'condo') return selectedCondo()?.name || 'Condomínio';
  return 'Dashboard';
}

function viewSubtitle() {
  if (state.view === 'companies') return 'Clientes SaaS, contratos e branding.';
  if (state.view === 'condominiums') return 'Carteira de edifícios disponível para a sua conta.';
  if (state.view === 'operations') return 'Ocorrências de todos os condomínios num único local.';
  if (state.view === 'obligations') return 'Prazos e inspeções de toda a carteira.';
  if (state.view === 'condo') {
    const condo = selectedCondo();
    const company = companyFor(condo);
    return `${company?.label || company?.name || ''}${condo?.city ? ` · ${condo.city}` : ''}`;
  }
  return isSuperAdmin() ? 'Visão global da plataforma SaaS.' : 'O que precisa da sua atenção hoje.';
}

function shell(content) {
  return ui.shell(state, content, {
    resident: isResidentOnly(), superAdmin: isSuperAdmin(),
    title: state.view === 'condo' ? selectedCondo()?.name : ''
  });
}

function kpi(label, value, foot, icon, tone = '') {
  return `<article class="kpi-card ${tone}"><div><span>${esc(label)}</span><strong>${value}</strong><small>${esc(foot)}</small></div><i>${icon}</i></article>`;
}

function statusPill(status, label = status) {
  const safe = String(status || 'neutral').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `<span class="status ${safe}">${esc(label || '—')}</span>`;
}

function empty(text, action = '') {
  return `<div class="empty"><div>◇</div><strong>Sem dados</strong><span>${esc(text)}</span>${action}</div>`;
}

function obligationState(item) {
  if (!item.active) return { key: 'inactive', label: 'Inativa', days: null };
  if (!item.next_date) return { key: 'neutral', label: 'Sem data', days: null };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const next = new Date(`${item.next_date}T00:00:00`);
  const days = Math.ceil((next - today) / 86400000);
  if (days < 0) return { key: 'overdue', label: 'Vencida', days };
  if (days <= 7) return { key: 'urgent', label: 'Urgente', days };
  if (days <= 30) return { key: 'warning', label: 'A vencer', days };
  return { key: 'active', label: 'Em dia', days };
}

function dashboardView() {
  return shell(ui.dashboard(state));
}

function attentionRows(issues, obligations) {
  const rows = [
    ...issues.filter(item => ['urgent', 'high'].includes(item.priority)).slice(0, 5).map(item => ({
      icon: '⚒', title: item.title, sub: `${condoName(item.condominium_id)} · ${item.place || 'Local por definir'}`,
      pill: statusPill(item.priority, item.priority === 'urgent' ? 'Urgente' : 'Alta'), condoId: item.condominium_id, tab: 'issues'
    })),
    ...obligations.filter(item => ['overdue', 'urgent'].includes(obligationState(item).key)).slice(0, 5).map(item => {
      const os = obligationState(item);
      return { icon: '◷', title: item.title, sub: `${condoName(item.condominium_id)} · ${date(item.next_date)}`, pill: statusPill(os.key, os.label), condoId: item.condominium_id, tab: 'obligations' };
    })
  ].slice(0, 8);
  if (!rows.length) return empty('Não existem ocorrências prioritárias nem obrigações críticas.');
  return `<div class="rows">${rows.map(item => `<button class="data-row row-button" data-condo="${item.condoId}" data-tab="${item.tab}"><div class="logo-dot condo">${item.icon}</div><div><strong>${esc(item.title)}</strong><small>${esc(item.sub)}</small></div><div class="right">${item.pill}<span>→</span></div></button>`).join('')}</div>`;
}

function companyRows(items) {
  if (!items.length) return empty('Ainda não existem empresas gestoras.');
  return `<div class="rows">${items.map(item => `
    <div class="data-row">
      <div class="logo-dot" style="--brand:${esc(item.brand_color || '#3768f5')}">${esc(initials(item.label || item.name))}</div>
      <div><strong>${esc(item.label || item.name)}</strong><small>${esc(item.name)} · ${esc(item.plan)}</small></div>
      <div class="right"><strong>${money(item.monthly_fee)}</strong>${statusPill(item.status, item.status === 'active' ? 'Ativa' : item.status)}</div>
    </div>`).join('')}</div>`;
}

function condoName(id) {
  return state.condominiums.find(item => item.id === id)?.name || 'Condomínio';
}

function condoRows(items, compact = false) {
  if (!items.length) return empty('Ainda não existem condomínios.');
  return `<div class="rows">${items.map(item => {
    const company = companyFor(item);
    const issueCount = state.issues.filter(issue => issue.condominium_id === item.id && !['resolved', 'closed'].includes(issue.status)).length;
    return `<button class="data-row row-button" data-condo="${item.id}">
      <div class="logo-dot condo">▥</div>
      <div><strong>${esc(item.name)}</strong><small>${esc(item.address || item.city || 'Sem morada')} · ${Number(item.fractions_count || state.fractions.filter(f => f.condominium_id === item.id).length)} frações</small></div>
      <div class="right">${!compact ? `<strong>${esc(company?.label || company?.name || '—')}</strong>` : ''}${issueCount ? `<span class="mini-count">${issueCount} abertas</span>` : statusPill(item.status, 'Operacional')}<span>→</span></div>
    </button>`;
  }).join('')}</div>`;
}

function companiesView() {
  return shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>Empresas gestoras</h2><p>Clientes que pagam a plataforma, respetivo plano e branding.</p></div>${isSuperAdmin() ? '<button class="primary-btn compact" data-open="company">＋ Nova empresa</button>' : ''}</div>
      ${companyRows(state.companies)}
    </section>`);
}

function condominiumsView() {
  const canCreate = isSuperAdmin() || state.companies.some(item => canManageCompany(item.id));
  return shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>Carteira de condomínios</h2><p>Selecione um edifício para entrar no respetivo workspace.</p></div>${canCreate && state.companies.length ? '<button class="primary-btn compact" data-open="condominium">＋ Novo condomínio</button>' : ''}</div>
      ${condoRows(ui.scopedCondos(state))}
    </section>`);
}

function operationsView() {
  const issues = ui.scopedItems(state,'issues');
  return shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>Ocorrências da carteira</h2><p>${issues.length} ocorrência(s).</p></div></div>
      ${issues.length ? `<div class="issue-grid">${issues.map(issueCard).join('')}</div>` : empty('Não existem ocorrências abertas.')}
    </section>`);
}

function obligationsView() {
  const items = [...state.obligations].sort((a, b) => String(a.next_date || '9999').localeCompare(String(b.next_date || '9999')));
  return shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>Obrigações da carteira</h2><p>Prazos configurados em todos os edifícios.</p></div></div>
      ${items.length ? `<div class="obligation-grid">${items.map(obligationCard).join('')}</div>` : empty('Ainda não existem obrigações configuradas.')}
    </section>`);
}

function issueCard(item) {
  return `<button class="issue-card" data-condo="${item.condominium_id}" data-tab="issues">
    <div class="issue-card-top"><span class="category-chip">${esc(item.category || 'Ocorrência')}</span>${statusPill(item.priority, item.priority === 'urgent' ? 'Urgente' : item.priority)}</div>
    <h3>${esc(item.title)}</h3><p>${esc(item.description || 'Sem descrição.')}</p>
    <footer><span>${esc(condoName(item.condominium_id))}</span><span>${dateTime(item.created_at)}</span></footer>
  </button>`;
}

function obligationCard(item) {
  const os = obligationState(item);
  return `<button class="obligation-card" data-condo="${item.condominium_id}" data-tab="obligations">
    <div><span class="category-chip">${esc(item.category)}</span>${statusPill(os.key, os.label)}</div>
    <h3>${esc(item.title)}</h3>
    <p>${esc(condoName(item.condominium_id))}</p>
    <footer><span>Próxima: ${date(item.next_date)}</span><span>${esc(item.frequency || 'Configurável')}</span></footer>
  </button>`;
}

function condoView() {
  const condo = selectedCondo();
  if (!condo) { state.view = 'condominiums'; return condominiumsView(); }
  const company = companyFor(condo);
  const canWork = canWorkCompany(condo.company_id) || isSuperAdmin();
  return shell(`
    <section class="condo-hero" style="--condo-brand:${esc(company?.brand_color || '#3768f5')}">
      <div class="condo-brand-mark">${esc(initials(company?.label || company?.name || condo.name))}</div>
      <div><span class="eyebrow">${esc(company?.label || company?.name || 'Gestora')}</span><h2>${esc(condo.name)}</h2><p>${esc([condo.address, condo.postal_code, condo.city].filter(Boolean).join(' · ') || 'Morada por preencher')}</p></div>
      <div class="condo-hero-side">${statusPill(condo.status, condo.status === 'active' ? 'Ativo' : condo.status)}<small>${state.fractions.filter(item => item.condominium_id === condo.id).length || condo.fractions_count || 0} frações</small></div>
    </section>
    <nav class="module-tabs">
      ${condoTab('overview', 'Resumo')}
      ${condoTab('fractions', 'Frações')}
      ${condoTab('issues', 'Ocorrências')}
      ${condoTab('notices', 'Avisos')}
      ${condoTab('documents', 'Documentos')}
      ${canWork ? condoTab('suppliers', 'Fornecedores') : ''}
      ${canWork ? condoTab('equipment', 'Equipamentos') : ''}
      ${canWork ? condoTab('maintenance', 'Manutenção') : ''}
      ${canWork ? condoTab('obligations', 'Obrigações') : ''}
    </nav>
    ${condoTabContent(condo, canWork)}`);
}

function condoTab(id, label) {
  return `<button class="module-tab ${state.condoTab === id ? 'active' : ''}" data-condo-tab="${id}">${label}</button>`;
}

function condoTabContent(condo, canWork) {
  if (state.condoTab === 'fractions') return fractionsTab(condo, canWork);
  if (state.condoTab === 'issues') return issuesTab(condo, canWork);
  if (state.condoTab === 'documents') return `<section class="panel"><div class="panel-head"><h2>Documentos</h2></div>${state.documents.filter(d=>d.condominium_id===condo.id).map(d=>`<button class="data-row row-button" data-document="${esc(d.id)}">${ui.icon('document')}<strong>${esc(d.name)}</strong>${ui.icon('chevron')}</button>`).join('')||empty('Sem documentos publicados.')}</section>`;
  if (state.condoTab === 'notices') return noticesTab(condo, canWork);
  if (state.condoTab === 'suppliers') return suppliersTab(condo, canWork);
  if (state.condoTab === 'equipment') return equipmentTab(condo, canWork);
  if (state.condoTab === 'maintenance') return maintenanceTab(condo, canWork);
  if (state.condoTab === 'obligations') return obligationsTab(condo, canWork);
  return overviewTab(condo);
}

function overviewTab(condo) {
  const id = condo.id;
  const fractions = state.fractions.filter(item => item.condominium_id === id);
  const issues = state.issues.filter(item => item.condominium_id === id && !['resolved', 'closed'].includes(item.status));
  const obligations = state.obligations.filter(item => item.condominium_id === id);
  const critical = obligations.filter(item => ['overdue', 'urgent'].includes(obligationState(item).key));
  const equipment = state.equipment.filter(item => item.condominium_id === id);
  return `<section class="kpi-grid compact-grid">
      ${kpi('Frações', fractions.length || condo.fractions_count || 0, 'Registadas', '▤')}
      ${kpi('Ocorrências', issues.length, 'Por resolver', '⚒', issues.some(i => ['urgent','high'].includes(i.priority)) ? 'danger' : '')}
      ${kpi('Equipamentos', equipment.length, 'Ativos inventariados', '◇')}
      ${kpi('Obrigações críticas', critical.length, 'Vencidas ou urgentes', '◷', critical.length ? 'warning-card' : '')}
    </section>
    <section class="two-col">
      <article class="panel"><div class="panel-head"><div><h2>Ocorrências recentes</h2><p>Acompanhamento operacional</p></div><button class="text-btn" data-condo-tab="issues">Abrir →</button></div>
        ${issues.length ? `<div class="rows">${issues.slice(0, 6).map(item => `<div class="data-row"><div class="logo-dot condo">⚒</div><div><strong>${esc(item.title)}</strong><small>${esc(item.place || item.category || 'Sem local')}</small></div><div class="right">${statusPill(item.priority, item.priority)}</div></div>`).join('')}</div>` : empty('Sem ocorrências abertas.')}
      </article>
      <article class="panel"><div class="panel-head"><div><h2>Próximas obrigações</h2><p>Inspeções, seguros e contratos</p></div><button class="text-btn" data-condo-tab="obligations">Abrir →</button></div>
        ${obligations.length ? `<div class="rows">${[...obligations].sort((a,b)=>String(a.next_date||'9999').localeCompare(String(b.next_date||'9999'))).slice(0,6).map(item => { const os=obligationState(item); return `<div class="data-row"><div class="logo-dot condo">◷</div><div><strong>${esc(item.title)}</strong><small>${date(item.next_date)} · ${esc(item.category)}</small></div><div class="right">${statusPill(os.key, os.label)}</div></div>`; }).join('')}</div>` : empty('Sem obrigações configuradas.')}
      </article>
    </section>`;
}

function fractionsTab(condo, canWork) {
  const items = state.fractions.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Frações</h2><p>Unidades do condomínio e permilagem.</p></div>${canWork ? '<button class="primary-btn compact" data-open="fraction">＋ Nova fração</button>' : ''}</div>
    ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Fração</th><th>Piso</th><th>Permilagem</th><th>Estado</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.code)}</strong></td><td>${esc(item.floor || '—')}</td><td>${item.permillage ?? '—'}</td><td>${statusPill(item.status, item.status === 'active' ? 'Ativa' : item.status)}</td></tr>`).join('')}</tbody></table></div>` : empty('Crie ou importe as frações deste condomínio.')}
  </section>`;
}

function issuesTab(condo, canWork) {
  const items = state.issues.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Ocorrências</h2><p>Problemas reportados por moradores e administração.</p></div><button class="primary-btn compact" data-open="issue">＋ Reportar</button></div>
    ${items.length ? `<div class="issue-grid">${items.map(issueCard).join('')}</div>` : empty('Ainda não foram reportadas ocorrências.')}
  </section>`;
}

function noticesTab(condo, canWork) {
  const items = state.notices.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Avisos</h2><p>Comunicações oficiais aos condóminos.</p></div>${canWork ? '<button class="primary-btn compact" data-open="notice">＋ Novo aviso</button>' : ''}</div>
    ${items.length ? `<div class="notice-list">${items.map(item => `<article class="notice-card ${item.important ? 'important' : ''}"><div><span class="category-chip">${item.important ? 'Importante' : 'Aviso'}</span>${item.requires_ack ? '<span class="ack-chip">Requer confirmação</span>' : ''}</div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p><footer>${dateTime(item.published_at)}</footer></article>`).join('')}</div>` : empty('Ainda não existem avisos publicados.')}
  </section>`;
}

function suppliersTab(condo, canWork) {
  const items = state.suppliers.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Fornecedores</h2><p>Prestadores de serviços associados ao edifício.</p></div>${canWork ? '<button class="primary-btn compact" data-open="supplier">＋ Fornecedor</button>' : ''}</div>
    ${items.length ? `<div class="supplier-grid">${items.map(item => `<article class="supplier-card"><div class="logo-dot">${esc(initials(item.name))}</div><div><span class="category-chip">${esc(item.category)}</span><h3>${esc(item.name)}</h3><p>${esc(item.contact_name || '')}${item.phone ? ` · ${esc(item.phone)}` : ''}</p><small>${esc(item.email || 'Sem email')}${item.sla ? ` · SLA ${esc(item.sla)}` : ''}</small></div>${statusPill(item.status, item.status === 'active' ? 'Ativo' : 'Inativo')}</article>`).join('')}</div>` : empty('Adicione os fornecedores responsáveis por elevadores, limpeza, portões, SCIE, etc.')}
  </section>`;
}

function equipmentTab(condo, canWork) {
  const items = state.equipment.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Equipamentos</h2><p>Inventário técnico e próxima manutenção.</p></div>${canWork ? '<button class="primary-btn compact" data-open="equipment">＋ Equipamento</button>' : ''}</div>
    ${items.length ? `<div class="equipment-grid">${items.map(item => { const supplier=state.suppliers.find(s=>s.id===item.supplier_id); return `<article class="equipment-card"><div class="equipment-icon">◇</div><div><span class="category-chip">${esc(item.category)}</span><h3>${esc(item.name)}</h3><p>${esc([item.brand,item.model].filter(Boolean).join(' ') || 'Marca/modelo por definir')}</p><small>${esc(item.location || 'Local por definir')} · ${supplier ? esc(supplier.name) : 'Sem fornecedor'}</small></div><div class="equipment-side">${statusPill(item.status, item.status === 'ok' ? 'OK' : item.status)}<small>Manut.: ${date(item.next_maintenance_on)}</small></div></article>`; }).join('')}</div>` : empty('Comece o Livro Técnico adicionando os equipamentos principais.')}
  </section>`;
}

function maintenanceTab(condo, canWork) {
  const items = state.maintenance.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Manutenção</h2><p>Preventiva, corretiva e inspeções.</p></div>${canWork ? '<button class="primary-btn compact" data-open="maintenance">＋ Intervenção</button>' : ''}</div>
    ${items.length ? `<div class="timeline-list">${items.map(item => { const eq=state.equipment.find(e=>e.id===item.equipment_id); return `<article class="timeline-item"><span class="timeline-dot"></span><div><span class="category-chip">${esc(item.maintenance_type)}</span><h3>${esc(item.title)}</h3><p>${esc(eq?.name || 'Sem equipamento associado')}${item.notes ? ` · ${esc(item.notes)}` : ''}</p><small>${item.completed_at ? `Concluída ${dateTime(item.completed_at)}` : `Agendada ${dateTime(item.scheduled_for)}`}</small></div>${statusPill(item.status, item.status === 'scheduled' ? 'Agendada' : item.status === 'done' ? 'Concluída' : item.status)}</article>`; }).join('')}</div>` : empty('Ainda não existe histórico de manutenção.')}
  </section>`;
}

function obligationsTab(condo, canWork) {
  const items = state.obligations.filter(item => item.condominium_id === condo.id);
  return `<section class="panel"><div class="panel-head"><div><h2>Obrigações e inspeções</h2><p>Prazos configuráveis do edifício.</p></div>${canWork ? '<button class="primary-btn compact" data-open="obligation">＋ Obrigação</button>' : ''}</div>
    ${items.length ? `<div class="obligation-grid">${items.map(obligationCard).join('')}</div>` : empty('Configure seguros, inspeções, contratos e outras obrigações.')}
  </section>`;
}

function modalShell(title, eyebrow, body) {
  return `<div class="modal-backdrop"><div class="modal modal-wide"><div class="modal-head"><div><span class="eyebrow blue">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div><button type="button" data-close>✕</button></div>${body}</div></div>`;
}

function openModal(type) {
  const host = document.querySelector('#modalHost');
  if (!host) return;
  const condo = selectedCondo();
  if (type === 'company') host.innerHTML = modalCompany();
  if (type === 'condominium') host.innerHTML = modalCondominium();
  if (type === 'fraction' && condo) host.innerHTML = modalFraction(condo);
  if (type === 'issue' && condo) host.innerHTML = modalIssue(condo);
  if (type === 'notice' && condo) host.innerHTML = modalNotice(condo);
  if (type === 'supplier' && condo) host.innerHTML = modalSupplier(condo);
  if (type === 'equipment' && condo) host.innerHTML = modalEquipment(condo);
  if (type === 'maintenance' && condo) host.innerHTML = modalMaintenance(condo);
  if (type === 'obligation' && condo) host.innerHTML = modalObligation(condo);
  bindModal(type);
}

function closeModal() {
  const host = document.querySelector('#modalHost');
  if (host) host.innerHTML = '';
}

function modalCompany() {
  return modalShell('Nova empresa gestora', 'SUPER ADMIN', `<form id="entityForm" class="form-grid"><label>Nome legal<input name="name" required></label><label>Label / marca<input name="label" required></label><label>NIF<input name="nif"></label><label>Email<input name="email" type="email"></label><label>Telefone<input name="phone"></label><label>Plano<select name="plan"><option>Starter</option><option>Pro</option><option>Business</option><option>Enterprise</option></select></label><label>Mensalidade (€)<input name="monthly_fee" type="number" step="0.01" value="49.90"></label><label>Cor da marca<input name="brand_color" type="color" value="#3768f5"></label>${modalActions('Criar empresa')}</form>`);
}

function modalCondominium() {
  const companies = state.companies.filter(item => canManageCompany(item.id));
  return modalShell('Novo condomínio', 'CARTEIRA', `<form id="entityForm" class="form-grid"><label>Empresa gestora<select name="company_id" required>${companies.map(item => `<option value="${item.id}">${esc(item.label || item.name)}</option>`).join('')}</select></label><label>Nome<input name="name" required></label><label class="wide">Morada<input name="address"></label><label>Código postal<input name="postal_code"></label><label>Cidade<input name="city"></label><label>N.º frações<input name="fractions_count" type="number" min="0" value="0"></label><label>Ref. contrato<input name="contract_ref"></label><label>Valor mensal (€)<input name="monthly_value" type="number" min="0" step="0.01" value="0"></label>${modalActions('Criar condomínio')}</form>`);
}

function modalFraction(condo) {
  return modalShell('Nova fração', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label>Fração / código<input name="code" required placeholder="2.º Esq."></label><label>Piso<input name="floor" placeholder="2"></label><label>Permilagem<input name="permillage" type="number" step="0.001"></label>${modalActions('Criar fração')}</form>`);
}

function modalIssue(condo) {
  return modalShell('Reportar ocorrência', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label class="wide">Título<input name="title" required placeholder="Luz da garagem avariada"></label><label>Categoria<select name="category"><option>Iluminação</option><option>Elevador</option><option>Portão</option><option>Água</option><option>Limpeza</option><option>Segurança</option><option>Outro</option></select></label><label>Local<input name="place" placeholder="Piso -2"></label><label>Prioridade<select name="priority"><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label><label>Visibilidade<select name="visibility"><option value="public">Moradores</option><option value="private">Privada</option></select></label><label class="wide">Descrição<textarea name="description" rows="4"></textarea></label>${modalActions('Enviar ocorrência')}</form>`);
}

function modalNotice(condo) {
  return modalShell('Novo aviso', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label class="wide">Título<input name="title" required></label><label class="wide">Mensagem<textarea name="body" rows="5" required></textarea></label><label class="check-label"><input type="checkbox" name="important"> Aviso importante</label><label class="check-label"><input type="checkbox" name="requires_ack"> Exigir confirmação de leitura</label>${modalActions('Publicar aviso')}</form>`);
}

function modalSupplier(condo) {
  return modalShell('Novo fornecedor', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label>Empresa<input name="name" required></label><label>Categoria<input name="category" placeholder="Elevadores"></label><label>Contacto<input name="contact_name"></label><label>Telefone<input name="phone"></label><label>Email<input name="email" type="email"></label><label>SLA<input name="sla" placeholder="24h"></label>${modalActions('Guardar fornecedor')}</form>`);
}

function modalEquipment(condo) {
  const suppliers = state.suppliers.filter(item => item.condominium_id === condo.id && item.status === 'active');
  return modalShell('Novo equipamento', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label>Nome<input name="name" required placeholder="Elevador A"></label><label>Categoria<input name="category" placeholder="Elevador"></label><label>Localização<input name="location" placeholder="Bloco A"></label><label>Fornecedor<select name="supplier_id"><option value="">Sem fornecedor</option>${suppliers.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></label><label>Marca<input name="brand"></label><label>Modelo<input name="model"></label><label>N.º série<input name="serial_number"></label><label>Próxima manutenção<input name="next_maintenance_on" type="date"></label><label>QR / código<input name="qr_code" placeholder="EQ-001"></label>${modalActions('Guardar equipamento')}</form>`);
}

function modalMaintenance(condo) {
  const equipment = state.equipment.filter(item => item.condominium_id === condo.id);
  const suppliers = state.suppliers.filter(item => item.condominium_id === condo.id && item.status === 'active');
  return modalShell('Nova intervenção', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label class="wide">Título<input name="title" required></label><label>Tipo<select name="maintenance_type"><option value="preventive">Preventiva</option><option value="corrective">Corretiva</option><option value="inspection">Inspeção</option><option value="other">Outra</option></select></label><label>Agendada para<input name="scheduled_for" type="datetime-local"></label><label>Equipamento<select name="equipment_id"><option value="">Sem equipamento</option>${equipment.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></label><label>Fornecedor<select name="supplier_id"><option value="">Sem fornecedor</option>${suppliers.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></label><label>Periodicidade<input name="frequency" placeholder="Semestral"></label><label class="wide">Notas<textarea name="notes" rows="4"></textarea></label>${modalActions('Agendar intervenção')}</form>`);
}

function modalObligation(condo) {
  const suppliers = state.suppliers.filter(item => item.condominium_id === condo.id && item.status === 'active');
  return modalShell('Nova obrigação', condo.name, `<form id="entityForm" class="form-grid"><input type="hidden" name="condominium_id" value="${condo.id}"><label class="wide">Título<input name="title" required placeholder="Seguro do edifício"></label><label>Categoria<select name="category"><option>Seguro</option><option>Elevadores</option><option>SCIE</option><option>Gás</option><option>Portões</option><option>Bombagem</option><option>Contrato</option><option>Outro</option></select></label><label>Periodicidade<input name="frequency" value="Anual"></label><label>Última execução<input name="last_date" type="date"></label><label>Próxima data<input name="next_date" type="date"></label><label>Responsável<input name="owner_name" value="Administração"></label><label>Fornecedor<select name="supplier_id"><option value="">Sem fornecedor</option>${suppliers.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></label><label class="wide">Notas<textarea name="notes" rows="3"></textarea></label>${modalActions('Guardar obrigação')}</form>`);
}

function modalActions(label) {
  return `<div class="modal-actions"><button type="button" class="ghost-btn" data-close>Cancelar</button><button class="primary-btn" type="submit">${esc(label)}</button></div>`;
}

function bindModal(type) {
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  document.querySelector('#entityForm')?.addEventListener('submit', event => submitEntity(event, type));
}

async function submitEntity(event, type) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  form.querySelector('button[type="submit"]').disabled = true;

  try {
    if (type === 'company') {
      values.monthly_fee = Number(values.monthly_fee || 0);
      await api.createCompany(values);
    }
    if (type === 'condominium') {
      values.fractions_count = Number(values.fractions_count || 0);
      values.monthly_value = Number(values.monthly_value || 0);
      await api.createCondominium(values);
    }
    if (type === 'fraction') {
      if (values.permillage) values.permillage = Number(values.permillage);
      else delete values.permillage;
      await api.createFraction(values);
    }
    if (type === 'issue') {
      values.reporter_user_id = state.user.id;
      values.supporters_count = 1;
      await api.createIssue(values);
    }
    if (type === 'notice') {
      values.important = form.elements.important.checked;
      values.requires_ack = form.elements.requires_ack.checked;
      await api.createNotice(values);
    }
    if (type === 'supplier') await api.createSupplier(values);
    if (type === 'equipment') {
      if (!values.supplier_id) delete values.supplier_id;
      if (!values.next_maintenance_on) delete values.next_maintenance_on;
      if (!values.qr_code) delete values.qr_code;
      await api.createEquipment(values);
    }
    if (type === 'maintenance') {
      if (!values.equipment_id) delete values.equipment_id;
      if (!values.supplier_id) delete values.supplier_id;
      if (!values.scheduled_for) delete values.scheduled_for;
      await api.createMaintenance(values);
    }
    if (type === 'obligation') {
      if (!values.supplier_id) delete values.supplier_id;
      if (!values.last_date) delete values.last_date;
      if (!values.next_date) delete values.next_date;
      await api.createObligation(values);
    }
    closeModal();
    state.info = 'Guardado com sucesso.';
    await loadContext();
  } catch (error) {
    form.querySelector('button[type="submit"]').disabled = false;
    const holder = document.querySelector('#modalHost .modal-head');
    if (holder) holder.insertAdjacentHTML('afterend', `<div class="flash error modal-flash">${esc(error.message)}</div>`);
  }
}

function residentDashboard() {
  return shell(ui.resident(state));
}

function goToView(view) {
  state.view = view;
  state.error = ''; state.info = '';
  render();
}

function chooseCondoFor(type) {
  const available = ui.scopedCondos(state);
  const preferred = available.find(c => c.id === state.residentCondoId || c.id === state.dashboardCondoId);
  if (preferred || available.length === 1) {
    state.selectedCondoId = (preferred || available[0]).id;
    openModal(type);
    return;
  }
  const host = document.querySelector('#modalHost');
  host.innerHTML = modalShell('Selecionar condomínio', 'NOVA OCORRÊNCIA', available.length
    ? `<div class="form-grid">${available.map(c => `<button type="button" class="ghost-btn" data-pick-condo="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>`
    : '<p class="cf-empty">Ainda não tem condomínios disponíveis.</p>');
  host.querySelector('[data-close]').onclick = closeModal;
  host.querySelectorAll('[data-pick-condo]').forEach(btn => btn.onclick = () => {
    state.selectedCondoId = btn.dataset.pickCondo; openModal(type);
  });
}

async function openDocument(id) {
  const item = state.documents.find(d => d.id === id);
  if (!item) return;
  const host = document.querySelector('#modalHost');
  let fileLink = '';
  // Only allow explicit web URLs; storage paths need the existing document's bucket configuration.
  try { const url = new URL(item.file_path); if (['https:', 'http:'].includes(url.protocol)) fileLink = `<a class="primary-btn" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Abrir documento</a>`; } catch {}
  host.innerHTML = modalShell(item.name, 'DOCUMENTO', `<div class="form-grid"><p class="wide">${esc(condoName(item.condominium_id))} · ${esc(item.category)} · ${date(item.document_date || item.created_at)}</p>${fileLink || '<p class="wide">Não existe uma ligação de ficheiro disponível para este documento.</p>'}</div>`);
  host.querySelector('[data-close]').onclick = closeModal;
}

function collectionView() {
  const title = ui.labels[state.view] || 'Visão geral';
  const condos = ui.scopedCondos(state);
  const header = `<div class="cf-form-line"><select id="condoFilter" class="cf-list-filter" aria-label="Filtrar condomínio"><option value="">Todos os condomínios</option>${state.condominiums.filter(c=>!state.dashboardCompanyId || c.company_id === state.dashboardCompanyId).map(c=>`<option value="${esc(c.id)}" ${c.id===state.dashboardCondoId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>`;
  let content = '';
  if (state.view === 'agenda') content = `<section class="panel"><div class="panel-head"><h2>Agenda</h2></div>${ui.agenda(state,100)}</section>`;
  if (['fractions','maintenance','notices','suppliers'].includes(state.view)) {
    const renderTab = {fractions:fractionsTab,maintenance:maintenanceTab,notices:noticesTab,suppliers:suppliersTab}[state.view];
    content = condos.map(c=>`<div class="cf-collection-group" data-collection-condo="${esc(c.id)}"><h2 class="cf-group-title">${esc(c.name)}</h2>${renderTab(c,canWorkCompany(c.company_id))}</div>`).join('') || `<section class="panel">${empty('Ainda não existem condomínios disponíveis.')}</section>`;
  }
  if (state.view === 'documents') {
    const items = ui.scopedItems(state,'documents');
    content = `<section class="panel"><div class="panel-head"><h2>Documentos</h2></div>${items.length ? `<div class="rows">${items.map(d=>`<button class="data-row row-button" data-document="${esc(d.id)}"><div class="cf-square-icon blue">${ui.icon('document')}</div><div><strong>${esc(d.name)}</strong><small>${esc(condoName(d.condominium_id))} · ${esc(d.category)}</small></div>${ui.icon('chevron')}</button>`).join('')}</div>` : empty('Sem documentos publicados.')}</section>`;
  }
  if (['assemblies','votes'].includes(state.view)) content = governance.collection(state,state.view);
  if (state.view === 'reservations') content = `<section class="panel"><div class="panel-head"><h2>${title}</h2></div><p class="cf-empty">Este módulo ainda não está disponível na plataforma.</p></section>`;
  if (state.view === 'reports') {
    const issues = ui.scopedItems(state,'issues');
    content = `<section class="panel"><div class="panel-head"><h2>Relatório de ocorrências</h2><button class="primary-btn" id="exportReport">Exportar CSV</button></div><div class="table-wrap"><table><thead><tr><th>Condomínio</th><th>Ocorrência</th><th>Estado</th></tr></thead><tbody>${issues.map(i=>`<tr><td>${esc(condoName(i.condominium_id))}</td><td>${esc(i.title)}</td><td>${esc(ui.issueLabel(i.status))}</td></tr>`).join('')}</tbody></table></div>${!issues.length?'<p class="cf-empty">Sem ocorrências para apresentar.</p>':''}</section>`;
  }
  return shell(header+content);
}

function settingsView() {
  return shell(`<section class="panel"><div class="panel-head"><h2>Configurações</h2></div><div class="cf-settings-grid"><button class="ghost-btn" data-view="profile">Perfil</button><button class="ghost-btn" id="reloadBtn">Atualizar dados</button><button class="ghost-btn" data-view="obligations">Obrigações</button></div><div id="settingsTools" class="cf-settings-tools">${isSuperAdmin() ? navItem('companies', 'Empresas gestoras', '▦') : ''}</div><div class="cf-settings-license"></div></section>`);
}

function profileView() {
  return shell(`<section class="panel"><div class="panel-head"><h2>Perfil</h2></div><p>${esc(state.profile?.full_name || 'Utilizador')}</p><p>${esc(state.user?.email || '')}</p><button class="ghost-btn" id="logoutBtn">Terminar sessão</button></section>`);
}

function searchView() {
  const term=state.searchQuery.trim().toLocaleLowerCase('pt-PT');
  const condos=ui.scopedCondos(state).filter(c=>`${c.name} ${c.address||''}`.toLocaleLowerCase('pt-PT').includes(term));
  const issues=ui.scopedItems(state,'issues').filter(i=>`${i.title} ${i.description||''}`.toLocaleLowerCase('pt-PT').includes(term));
  return shell(`<section class="panel"><div class="panel-head"><h2>Resultados para “${esc(state.searchQuery)}”</h2></div>${condos.length?condoRows(condos):''}${issues.length?`<div class="issue-grid">${issues.map(issueCard).join('')}</div>`:''}${!condos.length&&!issues.length?empty('Não foram encontrados resultados.'):''}</section>`);
}

function bind() {
  governance.bind(state,{reload:loadContext,modalShell,closeModal});
  document.querySelector('#authSwitch')?.addEventListener('click', () => {
    state.authMode = state.authMode === 'login' ? 'signup' : 'login';
    state.error = ''; state.info = ''; render();
  });

  document.querySelector('#authForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    state.error = ''; state.info = '';
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (state.authMode === 'signup') {
        const result = await api.signUp({ email: values.email, password: values.password, fullName: values.fullName });
        if (!result.session) {
          state.info = 'Conta criada. Confirme o email se a confirmação estiver ativa e depois faça login.';
          state.authMode = 'login';
          render();
        }
      } else {
        await api.signIn(values.email, values.password);
      }
    } catch (error) {
      state.error = error.message;
      render();
    }
  });

  document.querySelector('#logoutBtn')?.addEventListener('click', () => api.signOut());
  document.querySelector('#refreshAccess')?.addEventListener('click', () => loadContext());
  document.querySelector('#reloadBtn')?.addEventListener('click', () => loadContext());

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    state.view = button.dataset.view;
    state.error = ''; state.info = ''; render();
  }));

  document.querySelectorAll('[data-condo]').forEach(button => button.addEventListener('click', () => {
    state.selectedCondoId = button.dataset.condo;
    state.condoTab = button.dataset.tab || 'overview';
    state.view = 'condo';
    state.error = ''; state.info = ''; render();
  }));

  document.querySelectorAll('[data-condo-tab]').forEach(button => button.addEventListener('click', () => {
    state.condoTab = button.dataset.condoTab;
    render();
  }));

  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => {
    const collectionCondo = button.closest('[data-collection-condo]')?.dataset.collectionCondo;
    if (collectionCondo) state.selectedCondoId = collectionCondo;
    openModal(button.dataset.open);
  }));
  document.querySelector('#companyFilter')?.addEventListener('change', event => { state.dashboardCompanyId=event.target.value; state.dashboardCondoId='';render(); });
  document.querySelector('#condoFilter')?.addEventListener('change', event => { state.dashboardCondoId=event.target.value;render(); });
  document.querySelector('#residentCondo')?.addEventListener('change', event => { state.residentCondoId=event.target.value;state.dashboardCondoId=event.target.value;render(); });
  document.querySelectorAll('[data-new-issue]').forEach(btn=>btn.addEventListener('click',()=>{
    if(btn.dataset.residentCondo) state.residentCondoId=btn.dataset.residentCondo;
    chooseCondoFor('issue');
  }));
  document.querySelectorAll('[data-resident-route]').forEach(btn=>btn.addEventListener('click',()=>{
    state.dashboardCondoId=btn.dataset.residentCondo; goToView(btn.dataset.residentRoute);
  }));
  document.querySelectorAll('[data-document]').forEach(btn=>btn.addEventListener('click',()=>openDocument(btn.dataset.document)));
  document.querySelector('#globalSearch')?.addEventListener('submit',event=>{event.preventDefault();state.searchQuery=new FormData(event.target).get('q').trim();if(state.searchQuery) goToView('search');});
  document.querySelector('#menuToggle')?.addEventListener('click',event=>{const open=document.querySelector('.mockup-shell').classList.toggle('cf-menu-open');event.currentTarget.setAttribute('aria-expanded',String(open));});
  document.querySelector('#closeSidebar')?.addEventListener('click',()=>{document.querySelector('.mockup-shell').classList.remove('cf-menu-open');document.querySelector('#menuToggle')?.setAttribute('aria-expanded','false');});
  document.querySelector('#exportReport')?.addEventListener('click',()=>{
    const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const rows=[['Condomínio','Ocorrência','Estado'],...ui.scopedItems(state,'issues').map(i=>[condoName(i.condominium_id),i.title,ui.issueLabel(i.status)])];
    const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='ocorrencias.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}

function render() {
  if (state.loading) {
    app.innerHTML = '<div class="boot-screen"><div class="boot-mark">C</div><strong>Condomia</strong><span>A sincronizar com Supabase…</span></div>';
    return;
  }

  if (!state.user) app.innerHTML = authView();
  else if (!hasAnyAccess()) app.innerHTML = pendingView();
  else if (isResidentOnly() && state.view === 'dashboard') app.innerHTML = residentDashboard();
  else if (state.view === 'settings') app.innerHTML = settingsView();
  else if (state.view === 'profile') app.innerHTML = profileView();
  else if (state.view === 'search') app.innerHTML = searchView();
  else if (['fractions','maintenance','assemblies','votes','documents','notices','reservations','suppliers','reports','agenda'].includes(state.view)) app.innerHTML = collectionView();
  else if (state.view === 'companies') app.innerHTML = companiesView();
  else if (state.view === 'condominiums') app.innerHTML = condominiumsView();
  else if (state.view === 'operations') app.innerHTML = operationsView();
  else if (state.view === 'obligations') app.innerHTML = obligationsView();
  else if (state.view === 'condo') app.innerHTML = condoView();
  else app.innerHTML = dashboardView();

  bind();
}

api.onAuthStateChange((_event, session) => {
  const before = state.user?.id || null;
  const after = session?.user?.id || null;
  if (before !== after) loadContext({ keepView: false });
});

loadContext({ keepView: false });
