import { supabase } from './supabase.js';

let currentUser = null;
let access = null;
let companiesCache = [];
let brandedCompany = null;
let enhanceTimer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const money = value => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const dateTime = value => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const initials = value => String(value || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'CF';

function toast(message, tone = 'success') {
  document.querySelector('#adminToast')?.remove();
  const node = document.createElement('div');
  node.id = 'adminToast';
  node.className = `admin-toast ${tone}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3200);
}

function overlay(html) {
  closeOverlay();
  const node = document.createElement('div');
  node.id = 'adminOverlay';
  node.className = 'admin-overlay';
  node.innerHTML = html;
  document.body.append(node);
  node.querySelectorAll('[data-admin-close]').forEach(button => button.addEventListener('click', closeOverlay));
  node.addEventListener('click', event => {
    if (event.target === node) closeOverlay();
  });
  return node;
}

function closeOverlay() {
  document.querySelector('#adminOverlay')?.remove();
}

function logoMarkup(company, size = 'normal') {
  if (company?.logo_url) return `<div class="admin-logo-preview ${size}"><img src="${esc(company.logo_url)}" alt="${esc(company.label || company.name || 'Logótipo')}"></div>`;
  return `<div class="admin-logo-preview ${size} fallback" style="--company-brand:${esc(company?.brand_color || '#3768f5')}">${esc(initials(company?.label || company?.name))}</div>`;
}

async function getAccess() {
  const { data: sessionData } = await supabase.auth.getSession();
  currentUser = sessionData?.session?.user || null;
  if (!currentUser) {
    access = null;
    brandedCompany = null;
    return;
  }
  const { data, error } = await supabase.rpc('get_my_access_context').maybeSingle();
  if (!error) access = data;
}

async function ensureCompanies(force = false) {
  if (companiesCache.length && !force) return companiesCache;
  const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  companiesCache = data || [];
  return companiesCache;
}

async function loadBrandCompany() {
  if (!currentUser || access?.is_super_admin) {
    brandedCompany = null;
    return;
  }
  const { data: memberships, error } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', currentUser.id)
    .eq('status', 'active')
    .limit(1);
  if (error || !memberships?.length) return;
  const { data: company } = await supabase.from('companies').select('*').eq('id', memberships[0].company_id).maybeSingle();
  brandedCompany = company || null;
}

function applyBranding() {
  if (!brandedCompany || access?.is_super_admin) return;
  const brandColor = brandedCompany.brand_color || '#3768f5';
  document.documentElement.style.setProperty('--primary', brandColor);
  document.documentElement.style.setProperty('--primary-dark', brandColor);
  document.title = `${brandedCompany.label || brandedCompany.name} · Condomínio Fácil`;

  const brand = document.querySelector('.sidebar .brand');
  if (brand) {
    const mark = brand.querySelector('.brand-mark');
    if (mark) {
      if (brandedCompany.logo_url) {
        mark.classList.add('white-label-logo');
        mark.innerHTML = `<img src="${esc(brandedCompany.logo_url)}" alt="${esc(brandedCompany.label || brandedCompany.name)}">`;
      } else {
        mark.classList.remove('white-label-logo');
        mark.textContent = initials(brandedCompany.label || brandedCompany.name);
        mark.style.background = brandColor;
      }
    }
    const title = brand.querySelector('strong');
    const sub = brand.querySelector('small');
    if (title) title.textContent = brandedCompany.label || brandedCompany.name;
    if (sub) sub.textContent = 'GESTÃO DE CONDOMÍNIOS';
  }

  document.querySelectorAll('.condo-brand-mark').forEach(mark => {
    if (brandedCompany.logo_url && !mark.querySelector('img')) {
      mark.classList.add('white-label-logo');
      mark.innerHTML = `<img src="${esc(brandedCompany.logo_url)}" alt="${esc(brandedCompany.label || brandedCompany.name)}">`;
    }
  });
}

async function pendingCount() {
  if (!access?.is_super_admin) return 0;
  const { data, error } = await supabase.rpc('list_pending_users');
  if (error) return 0;
  return (data || []).length;
}

async function updatePendingBadge() {
  const badge = document.querySelector('.admin-users-nav .admin-badge');
  if (!badge) return;
  const count = await pendingCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

function injectUsersNav() {
  if (!access?.is_super_admin) return;
  const nav = document.querySelector('.sidebar nav');
  if (!nav || nav.querySelector('.admin-users-nav')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-item admin-users-nav';
  button.innerHTML = '<span>◎</span>Utilizadores <b class="admin-badge" hidden>0</b>';
  button.addEventListener('click', openPendingUsers);
  const companiesButton = [...nav.querySelectorAll('.nav-item')].find(item => item.textContent.includes('Empresas gestoras'));
  if (companiesButton?.nextSibling) nav.insertBefore(button, companiesButton.nextSibling);
  else nav.append(button);
  updatePendingBadge();
}

async function enhanceCompanyRows() {
  if (!access?.is_super_admin) return;
  const title = document.querySelector('.topbar h1')?.textContent?.trim();
  if (title !== 'Empresas gestoras') return;
  let companies;
  try { companies = await ensureCompanies(); } catch { return; }
  const rows = document.querySelectorAll('.panel .rows > .data-row');
  rows.forEach(row => {
    if (row.dataset.adminEnhanced === '1') return;
    const label = row.querySelector('div:nth-child(2) strong')?.textContent?.trim();
    const company = companies.find(item => (item.label || item.name) === label || item.name === label);
    if (!company) return;
    row.dataset.adminEnhanced = '1';
    row.dataset.companyId = company.id;
    row.classList.add('admin-company-row');
    const right = row.querySelector('.right');
    if (right) {
      const manage = document.createElement('button');
      manage.type = 'button';
      manage.className = 'admin-manage-btn';
      manage.textContent = 'Gerir';
      manage.addEventListener('click', event => {
        event.stopPropagation();
        openCompany(company.id);
      });
      right.append(manage);
    }
    row.addEventListener('click', () => openCompany(company.id));
  });
}

async function openPendingUsers() {
  if (!access?.is_super_admin) return;
  const companies = await ensureCompanies(true);
  const { data: users, error } = await supabase.rpc('list_pending_users');
  if (error) return toast(error.message, 'error');
  const items = users || [];
  const companyOptions = companies.map(company => `<option value="${company.id}">${esc(company.label || company.name)}</option>`).join('');
  const node = overlay(`
    <section class="admin-modal admin-modal-wide">
      <header class="admin-modal-head">
        <div><span class="admin-eyebrow">SUPER ADMIN</span><h2>Utilizadores e pedidos de acesso</h2><p>Contas criadas que ainda não pertencem a nenhuma empresa ou condomínio.</p></div>
        <button class="admin-close" data-admin-close>✕</button>
      </header>
      <div class="admin-modal-body">
        <div class="admin-summary-strip"><strong>${items.length}</strong><span>conta(s) a aguardar ativação</span></div>
        <div class="admin-pending-list">
          ${items.length ? items.map(user => `
            <article class="admin-pending-card" data-pending-user="${user.user_id}">
              <div class="admin-user-avatar">${esc(initials(user.full_name || user.email))}</div>
              <div class="admin-pending-info"><strong>${esc(user.full_name || user.email)}</strong><span>${esc(user.email)}</span><small>Criada ${esc(dateTime(user.created_at))}</small></div>
              <div class="admin-activation-controls">
                <select data-company><option value="">Escolher empresa…</option>${companyOptions}</select>
                <select data-role><option value="admin">Administrador</option><option value="manager">Gestor</option><option value="staff">Funcionário</option></select>
                <button class="admin-primary" data-activate>Ativar conta</button>
              </div>
            </article>`).join('') : '<div class="admin-empty"><strong>Sem contas pendentes</strong><span>Todas as contas criadas já têm acesso atribuído.</span></div>'}
        </div>
      </div>
    </section>`);

  node.querySelectorAll('[data-activate]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-pending-user]');
    const companyId = card.querySelector('[data-company]').value;
    const role = card.querySelector('[data-role]').value;
    if (!companyId) return toast('Escolha primeiro a empresa gestora.', 'error');
    button.disabled = true;
    button.textContent = 'A ativar…';
    const { error: activationError } = await supabase.rpc('activate_company_user', {
      p_user_id: card.dataset.pendingUser,
      p_company_id: companyId,
      p_role: role
    });
    if (activationError) {
      button.disabled = false;
      button.textContent = 'Ativar conta';
      return toast(activationError.message, 'error');
    }
    toast('Conta ativada com sucesso.');
    await updatePendingBadge();
    openPendingUsers();
  }));
}

function memberRow(member) {
  const roleLabels = { admin: 'Administrador', manager: 'Gestor', staff: 'Funcionário' };
  return `<div class="admin-member-row" data-member-id="${member.member_id}">
    <div class="admin-user-avatar small">${esc(initials(member.full_name || member.email))}</div>
    <div class="admin-member-info"><strong>${esc(member.full_name || member.email)}</strong><span>${esc(member.email)}</span></div>
    <select data-member-role>
      ${['admin','manager','staff'].map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${roleLabels[role]}</option>`).join('')}
    </select>
    <select data-member-status>
      <option value="active" ${member.status === 'active' ? 'selected' : ''}>Ativo</option>
      <option value="blocked" ${member.status === 'blocked' ? 'selected' : ''}>Bloqueado</option>
      <option value="pending" ${member.status === 'pending' ? 'selected' : ''}>Pendente</option>
    </select>
    <button class="admin-mini" data-member-save>Guardar</button>
    <button class="admin-mini danger" data-member-remove>Remover</button>
  </div>`;
}

async function openCompany(companyId) {
  if (!access?.is_super_admin) return;
  const [{ data: company, error: companyError }, { data: members, error: membersError }, condoCountResult] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).maybeSingle(),
    supabase.rpc('list_company_users', { p_company_id: companyId }),
    supabase.from('condominiums').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  ]);
  if (companyError || !company) return toast(companyError?.message || 'Empresa não encontrada.', 'error');
  if (membersError) return toast(membersError.message, 'error');
  const companyMembers = members || [];
  const condoCount = condoCountResult.count || 0;

  const node = overlay(`
    <section class="admin-modal admin-company-modal">
      <header class="admin-modal-head company-head" style="--company-brand:${esc(company.brand_color || '#3768f5')}">
        ${logoMarkup(company, 'large')}
        <div class="grow"><span class="admin-eyebrow">EMPRESA GESTORA</span><h2>${esc(company.label || company.name)}</h2><p>${esc(company.name)} · ${esc(company.plan || 'Starter')}</p></div>
        <span class="admin-status ${esc(company.status)}">${company.status === 'active' ? 'Ativa' : esc(company.status)}</span>
        <button class="admin-close" data-admin-close>✕</button>
      </header>
      <div class="admin-company-kpis">
        <div><strong>${condoCount}</strong><span>Condomínios</span></div>
        <div><strong>${companyMembers.length}</strong><span>Utilizadores</span></div>
        <div><strong>${money(company.monthly_fee)}</strong><span>Mensalidade</span></div>
        <div><strong>${esc(company.plan || 'Starter')}</strong><span>Plano</span></div>
      </div>
      <div class="admin-modal-body admin-company-grid">
        <section class="admin-card">
          <div class="admin-section-head"><div><h3>Dados da empresa</h3><p>Informação comercial, plano e contrato.</p></div></div>
          <form id="adminCompanyForm" class="admin-form-grid">
            <label>Nome legal<input name="name" value="${esc(company.name || '')}" required></label>
            <label>Marca / label<input name="label" value="${esc(company.label || '')}" required></label>
            <label>NIF<input name="nif" value="${esc(company.nif || '')}"></label>
            <label>Email<input name="email" type="email" value="${esc(company.email || '')}"></label>
            <label>Telefone<input name="phone" value="${esc(company.phone || '')}"></label>
            <label>Plano<select name="plan">${['Starter','Pro','Business','Enterprise'].map(plan => `<option ${company.plan === plan ? 'selected' : ''}>${plan}</option>`).join('')}</select></label>
            <label>Mensalidade (€)<input name="monthly_fee" type="number" step="0.01" value="${Number(company.monthly_fee || 0)}"></label>
            <label>Estado<select name="status"><option value="active" ${company.status === 'active' ? 'selected' : ''}>Ativa</option><option value="suspended" ${company.status === 'suspended' ? 'selected' : ''}>Suspensa</option><option value="cancelled" ${company.status === 'cancelled' ? 'selected' : ''}>Cancelada</option></select></label>
            <label>Início contrato<input name="contract_start" type="date" value="${esc(company.contract_start || '')}"></label>
            <label>Fim contrato<input name="contract_end" type="date" value="${esc(company.contract_end || '')}"></label>
            <label class="wide">Notas<textarea name="notes" rows="3">${esc(company.notes || '')}</textarea></label>
            <div class="admin-form-actions wide"><button class="admin-primary" type="submit">Guardar alterações</button></div>
          </form>
        </section>

        <section class="admin-card branding-card">
          <div class="admin-section-head"><div><h3>White-label</h3><p>Marca apresentada aos utilizadores desta gestora.</p></div></div>
          <div class="admin-brand-preview" style="--company-brand:${esc(company.brand_color || '#3768f5')}">
            ${logoMarkup(company, 'large')}
            <div><strong>${esc(company.label || company.name)}</strong><span>Portal de condomínios</span></div>
          </div>
          <label class="admin-field">Cor principal<input id="adminBrandColor" type="color" value="${esc(company.brand_color || '#3768f5')}"></label>
          <label class="admin-upload-box">Logótipo da empresa<input id="adminLogoFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><span>PNG, JPG, WEBP ou SVG · máximo 5 MB</span></label>
          <div class="admin-inline-actions"><button class="admin-primary" id="adminSaveBrand" type="button">Guardar branding</button>${company.logo_url ? '<button class="admin-secondary danger-text" id="adminRemoveLogo" type="button">Remover logótipo</button>' : ''}</div>
        </section>

        <section class="admin-card wide-card">
          <div class="admin-section-head"><div><h3>Utilizadores da empresa</h3><p>Administradores, gestores e funcionários com acesso.</p></div></div>
          <form id="adminInviteForm" class="admin-invite-form">
            <input name="fullName" placeholder="Nome completo">
            <input name="email" type="email" required placeholder="email@empresa.pt">
            <select name="role"><option value="admin">Administrador</option><option value="manager">Gestor</option><option value="staff">Funcionário</option></select>
            <button class="admin-primary" type="submit">Convidar</button>
          </form>
          <div class="admin-members-list">${companyMembers.length ? companyMembers.map(memberRow).join('') : '<div class="admin-empty compact"><strong>Sem utilizadores</strong><span>Convide o primeiro administrador desta empresa.</span></div>'}</div>
        </section>

        <section class="admin-card wide-card danger-zone">
          <div><h3>Zona de gestão</h3><p>Suspender mantém todos os dados. Eliminar remove a empresa e os respetivos condomínios e dados associados.</p></div>
          <div class="admin-inline-actions">
            <button class="admin-secondary" id="adminToggleCompany" type="button">${company.status === 'active' ? 'Suspender empresa' : 'Reativar empresa'}</button>
            <button class="admin-danger" id="adminDeleteCompany" type="button">Eliminar empresa</button>
          </div>
        </section>
      </div>
    </section>`);

  node.querySelector('#adminCompanyForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.monthly_fee = Number(values.monthly_fee || 0);
    values.contract_start = values.contract_start || null;
    values.contract_end = values.contract_end || null;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const { error } = await supabase.from('companies').update(values).eq('id', company.id);
    if (error) {
      button.disabled = false;
      return toast(error.message, 'error');
    }
    companiesCache = [];
    toast('Empresa atualizada.');
    setTimeout(() => location.reload(), 450);
  });

  node.querySelector('#adminSaveBrand')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const color = node.querySelector('#adminBrandColor').value;
    const file = node.querySelector('#adminLogoFile').files?.[0] || null;
    if (file && file.size > 5 * 1024 * 1024) return toast('O logótipo não pode ultrapassar 5 MB.', 'error');
    button.disabled = true;
    button.textContent = 'A guardar…';
    let logoUrl = company.logo_url || null;
    if (file) {
      const path = `${company.id}/logo`;
      const { error: uploadError } = await supabase.storage.from('company-branding').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
      if (uploadError) {
        button.disabled = false;
        button.textContent = 'Guardar branding';
        return toast(uploadError.message, 'error');
      }
      const { data: publicData } = supabase.storage.from('company-branding').getPublicUrl(path);
      logoUrl = `${publicData.publicUrl}?v=${Date.now()}`;
    }
    const { error } = await supabase.from('companies').update({ brand_color: color, logo_url: logoUrl }).eq('id', company.id);
    if (error) return toast(error.message, 'error');
    companiesCache = [];
    toast('White-label atualizado.');
    setTimeout(() => location.reload(), 450);
  });

  node.querySelector('#adminRemoveLogo')?.addEventListener('click', async () => {
    const { error: storageError } = await supabase.storage.from('company-branding').remove([`${company.id}/logo`]);
    if (storageError) console.warn(storageError);
    const { error } = await supabase.from('companies').update({ logo_url: null }).eq('id', company.id);
    if (error) return toast(error.message, 'error');
    toast('Logótipo removido.');
    setTimeout(() => location.reload(), 450);
  });

  node.querySelector('#adminInviteForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A enviar…';
    const result = await supabase.functions.invoke('invite-member', {
      body: { email: values.email, fullName: values.fullName, companyId: company.id, companyRole: values.role }
    });
    if (result.error || result.data?.error) {
      button.disabled = false;
      button.textContent = 'Convidar';
      return toast(result.data?.error || result.error?.message || 'Não foi possível convidar.', 'error');
    }
    toast(result.data?.invited ? 'Convite enviado e acesso criado.' : 'Utilizador existente associado à empresa.');
    openCompany(company.id);
  });

  node.querySelectorAll('[data-member-save]').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest('[data-member-id]');
    const payload = { role: row.querySelector('[data-member-role]').value, status: row.querySelector('[data-member-status]').value };
    const { error } = await supabase.from('company_members').update(payload).eq('id', row.dataset.memberId);
    if (error) return toast(error.message, 'error');
    toast('Acesso atualizado.');
  }));

  node.querySelectorAll('[data-member-remove]').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest('[data-member-id]');
    if (!confirm('Remover este utilizador da empresa? A conta Auth não será apagada.')) return;
    const { error } = await supabase.from('company_members').delete().eq('id', row.dataset.memberId);
    if (error) return toast(error.message, 'error');
    toast('Utilizador removido da empresa.');
    openCompany(company.id);
  }));

  node.querySelector('#adminToggleCompany')?.addEventListener('click', async () => {
    const nextStatus = company.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.from('companies').update({ status: nextStatus }).eq('id', company.id);
    if (error) return toast(error.message, 'error');
    companiesCache = [];
    toast(nextStatus === 'active' ? 'Empresa reativada.' : 'Empresa suspensa.');
    setTimeout(() => location.reload(), 450);
  });

  node.querySelector('#adminDeleteCompany')?.addEventListener('click', async () => {
    const confirmation = prompt(`Esta ação elimina a empresa, os condomínios e os dados associados.\n\nEscreva ELIMINAR para confirmar:`);
    if (confirmation !== 'ELIMINAR') return;
    const { error } = await supabase.from('companies').delete().eq('id', company.id);
    if (error) return toast(error.message, 'error');
    await supabase.storage.from('company-branding').remove([`${company.id}/logo`]);
    companiesCache = [];
    closeOverlay();
    toast('Empresa eliminada.');
    setTimeout(() => location.reload(), 600);
  });
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => {
    injectUsersNav();
    applyBranding();
    enhanceCompanyRows();
  }, 60);
}

async function initialize() {
  await getAccess();
  if (currentUser && !access?.is_super_admin) await loadBrandCompany();
  scheduleEnhance();
}

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.documentElement, { childList: true, subtree: true });

supabase.auth.onAuthStateChange(() => {
  setTimeout(initialize, 50);
});

initialize();
