import { supabase } from './supabase.js';
import {planFields,bindPlanFields,planSummary,enrichLicensePlans} from './plans.js';

let access = null;
let currentUser = null;
let timer = null;
let retryCount = 0;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value ? new Intl.DateTimeFormat('pt-PT',{dateStyle:'medium'}).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';

function toast(message, error = false) {
  document.querySelector('.cf-license-authority-toast')?.remove();
  const node = document.createElement('div');
  node.className = `cf-license-toast cf-license-authority-toast ${error ? 'error' : ''}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

async function resolveAccess() {
  const { data: sessionData } = await supabase.auth.getSession();
  currentUser = sessionData?.session?.user || null;
  access = null;
  if (!currentUser) return null;

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_access_context').maybeSingle();
  if (!rpcError && rpcData) {
    access = rpcData;
    return access;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id,full_name,is_super_admin')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (!profileError && profile) {
    access = profile;
    return access;
  }

  return null;
}

function isSuper() {
  return Boolean(access?.is_super_admin);
}

function stateOf(license) {
  if (!license) return { key:'missing', label:'Sem licença' };
  if (license.status !== 'active') return { key:license.status, label:({suspended:'Suspensa',expired:'Expirada',cancelled:'Cancelada'})[license.status] || license.status };
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(`${license.expires_on}T00:00:00`);
  if (expiry < today) return { key:'expired', label:'Expirada' };
  const days = Math.ceil((expiry - today) / 86400000);
  return days <= 7 ? { key:'warning', label:`Expira em ${days} dia${days === 1 ? '' : 's'}` } : { key:'active', label:'Ativa' };
}

async function loadData() {
  const [{ data: admins, error: adminError }, { data: licenses, error: licenseError }] = await Promise.all([
    supabase.rpc('list_company_admins_for_licensing'),
    supabase.rpc('list_company_admin_licenses')
  ]);
  if (adminError) throw adminError;
  if (licenseError) throw licenseError;
  return { admins: admins || [], licenses: await enrichLicensePlans(supabase,licenses) };
}

function latestFor(admin, licenses) {
  return licenses.find(row => row.company_id === admin.company_id && row.user_id === admin.user_id) || null;
}

function closeOverlay() {
  document.querySelector('.cf-license-authority-overlay')?.remove();
}

function overlay(html) {
  closeOverlay();
  const root = document.createElement('div');
  root.className = 'cf-license-overlay cf-license-authority-overlay';
  root.innerHTML = html;
  document.body.appendChild(root);
  root.querySelectorAll('[data-sa-close]').forEach(btn => btn.addEventListener('click', closeOverlay));
  root.addEventListener('click', e => { if (e.target === root) closeOverlay(); });
  return root;
}

async function issueLicense(admin, refresh) {
  const root = overlay(`<section class="cf-license-modal"><header><div><span>SUPER ADMIN · EMITIR</span><h2>${esc(admin.company_name)}</h2><p>${esc(admin.full_name)} · ${esc(admin.email)}</p></div><button data-sa-close>✕</button></header><form data-sa-form>
    ${planFields()}
    <label>Ciclo<select name="cycle"><option value="monthly">Mensal</option><option value="annual">Anual</option></select></label>
    <label>Início<input name="starts" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label class="wide">Notas<textarea name="notes" rows="3"></textarea></label>
    <div class="actions wide"><button type="button" data-sa-close>Cancelar</button><button class="primary" type="submit">Emitir licença</button></div>
  </form></section>`);
  bindPlanFields(root);
  root.querySelector('[data-sa-form]').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'A emitir…';
    const { error } = await supabase.rpc('issue_planned_company_license', {
      p_company_id: admin.company_id,
      p_user_id: admin.user_id,
      p_billing_cycle: fd.get('cycle'),
      p_starts_on: fd.get('starts'),
      p_plan_id: fd.get('plan_id'),
      p_extra_packs: Number(fd.get('extra_packs')||0),
      p_notes: fd.get('notes') || null
    });
    if (error) { btn.disabled = false; btn.textContent = 'Emitir licença'; return toast(error.message, true); }
    closeOverlay(); toast('Licença emitida com sucesso.'); await refresh();
  });
}

async function editLicense(license, refresh) {
  const root = overlay(`<section class="cf-license-modal"><header><div><span>SUPER ADMIN · EDITAR</span><h2>${esc(license.company_name || 'Licença')}</h2><p>${esc(license.full_name || license.email || '')}</p></div><button data-sa-close>✕</button></header><form data-sa-form>
    ${planFields(license.plan_id,license.extra_packs)}
    <label>Ciclo<select name="cycle"><option value="monthly" ${license.billing_cycle === 'monthly' ? 'selected' : ''}>Mensal</option><option value="annual" ${license.billing_cycle === 'annual' ? 'selected' : ''}>Anual</option></select></label>
    <label>Início<input name="starts" type="date" value="${esc(license.starts_on || '')}" required></label>
    <label>Fim<input name="expires" type="date" value="${esc(license.expires_on || '')}" required></label>
    <label class="wide">Notas<textarea name="notes" rows="3">${esc(license.notes || '')}</textarea></label>
    <div class="actions wide"><button type="button" data-sa-close>Cancelar</button><button class="primary" type="submit">Guardar</button></div>
  </form></section>`);
  bindPlanFields(root);
  root.querySelector('[data-sa-form]').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.rpc('update_planned_company_license', {
      p_license_id: license.id,
      p_billing_cycle: fd.get('cycle'),
      p_starts_on: fd.get('starts'),
      p_expires_on: fd.get('expires'),
      p_plan_id: fd.get('plan_id'),
      p_extra_packs: Number(fd.get('extra_packs')||0),
      p_notes: fd.get('notes') || null
    });
    if (error) return toast(error.message, true);
    closeOverlay(); toast('Licença atualizada.'); await refresh();
  });
}

async function renewLicense(license, refresh) {
  const root = overlay(`<section class="cf-license-modal"><header><div><span>SUPER ADMIN · RENOVAR</span><h2>${esc(license.company_name || 'Licença')}</h2><p>Escolha o período a acrescentar.</p></div><button data-sa-close>✕</button></header><form data-sa-form>
    <label class="wide">Renovação<select name="cycle"><option value="monthly">+ 1 mês</option><option value="annual">+ 1 ano</option></select></label>
    <div class="actions wide"><button type="button" data-sa-close>Cancelar</button><button class="primary" type="submit">Renovar</button></div>
  </form></section>`);
  root.querySelector('[data-sa-form]').addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const { error } = await supabase.rpc('renew_company_admin_license', { p_license_id: license.id, p_billing_cycle: fd.get('cycle') });
    if (error) return toast(error.message, true);
    closeOverlay(); toast('Licença renovada.'); await refresh();
  });
}

async function changeStatus(license, status, refresh) {
  const text = status === 'suspended' ? 'Suspender esta licença?' : status === 'active' ? 'Reativar esta licença?' : 'Cancelar esta licença?';
  if (!confirm(text)) return;
  const { error } = await supabase.rpc('set_company_admin_license_status', { p_license_id: license.id, p_status: status });
  if (error) return toast(error.message, true);
  toast(status === 'active' ? 'Licença reativada.' : status === 'suspended' ? 'Licença suspensa.' : 'Licença cancelada.');
  await refresh();
}

function buttons(admin, license) {
  const state = stateOf(license);
  if (!license) return `<button data-sa-issue="${admin.company_id}|${admin.user_id}">Emitir</button>`;
  const common = `<button data-sa-edit="${license.id}">Editar</button><button data-sa-renew="${license.id}">Renovar</button>`;
  if (['cancelled','expired'].includes(state.key)) return `<button data-sa-issue="${admin.company_id}|${admin.user_id}">Emitir nova</button>${common}`;
  return `${common}${license.status === 'active' ? `<button class="danger" data-sa-status="${license.id}|suspended">Suspender</button>` : ''}${license.status === 'suspended' ? `<button data-sa-status="${license.id}|active">Reativar</button>` : ''}<button class="danger" data-sa-status="${license.id}|cancelled">Cancelar</button>`;
}

async function openLicenses(companyId = null) {
  if (!isSuper()) {
    await resolveAccess();
    if (!isSuper()) return toast('Esta área é exclusiva do Super Admin.', true);
  }
  try {
    const ctx = await loadData();
    const admins = companyId ? ctx.admins.filter(a => a.company_id === companyId) : ctx.admins;
    const root = overlay(`<section class="cf-license-page">
      <header><div><span>SUPER ADMIN</span><h2>Gestão de licenças</h2><p>${companyId ? esc(admins[0]?.company_name || 'Empresa gestora') : 'Administradores das empresas gestoras'}</p></div><button data-sa-close>✕</button></header>
      <div class="cf-license-table-wrap" style="padding-top:22px"><table class="cf-license-table"><thead><tr><th>Empresa</th><th>Administrador</th><th>Ciclo</th><th>Início</th><th>Fim</th><th>Estado</th><th>Ações</th></tr></thead><tbody>${admins.length ? admins.map(admin => { const license = latestFor(admin,ctx.licenses); const state = stateOf(license); return `<tr><td><strong>${esc(admin.company_name)}</strong><small>${esc(planSummary(license))}</small></td><td><strong>${esc(admin.full_name)}</strong><small>${esc(admin.email)}</small></td><td>${license ? (license.billing_cycle === 'annual' ? 'Anual' : 'Mensal') : '—'}</td><td>${license ? fmt(license.starts_on) : '—'}</td><td>${license ? fmt(license.expires_on) : '—'}</td><td><span class="cf-license-pill ${state.key}">${esc(state.label)}</span></td><td class="cf-license-actions">${buttons(admin,license)}</td></tr>`; }).join('') : '<tr><td colspan="7">Sem administradores para apresentar.</td></tr>'}</tbody></table></div>
    </section>`);
    const refresh = async () => openLicenses(companyId);
    root.querySelectorAll('[data-sa-issue]').forEach(btn => btn.addEventListener('click', () => { const [c,u] = btn.dataset.saIssue.split('|'); issueLicense(ctx.admins.find(a => a.company_id === c && a.user_id === u), refresh); }));
    root.querySelectorAll('[data-sa-edit]').forEach(btn => btn.addEventListener('click', () => editLicense(ctx.licenses.find(l => l.id === btn.dataset.saEdit), refresh)));
    root.querySelectorAll('[data-sa-renew]').forEach(btn => btn.addEventListener('click', () => renewLicense(ctx.licenses.find(l => l.id === btn.dataset.saRenew), refresh)));
    root.querySelectorAll('[data-sa-status]').forEach(btn => btn.addEventListener('click', () => { const [id,status] = btn.dataset.saStatus.split('|'); changeStatus(ctx.licenses.find(l => l.id === id), status, refresh); }));
  } catch (error) {
    toast(error.message || 'Não foi possível abrir as licenças.', true);
  }
}

function ensureNav() {
  if (!isSuper()) return;
  document.querySelector('.cf-license-gate')?.remove();
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;
  nav.querySelectorAll('.cf-license-nav, [data-sa-licenses-nav]').forEach(btn => btn.remove());
  if (nav.querySelector('.cf-license-nav-authority')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item cf-license-nav-authority';
  btn.innerHTML = '<span>◇</span>Licenças';
  btn.addEventListener('click', () => openLicenses());
  const companies = [...nav.querySelectorAll('.nav-item')].find(item => item.textContent.includes('Empresas gestoras'));
  if (companies?.nextSibling) nav.insertBefore(btn, companies.nextSibling); else nav.appendChild(btn);
}

async function ensureCompanyButton() {
  if (!isSuper()) return;
  const modal = document.querySelector('.admin-company-modal');
  if (!modal || modal.querySelector('[data-sa-company-license]')) return;
  const title = modal.querySelector('.company-head h2')?.textContent?.trim();
  if (!title) return;
  const { data: companies } = await supabase.from('companies').select('id,name,label');
  const company = (companies || []).find(c => (c.label || c.name) === title || c.name === title);
  if (!company) return;
  const card = [...modal.querySelectorAll('.admin-card')].find(node => node.querySelector('h3')?.textContent?.includes('Utilizadores da empresa'));
  const head = card?.querySelector('.admin-section-head');
  if (!head) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'admin-secondary';
  btn.dataset.saCompanyLicense = company.id;
  btn.textContent = 'Gerir licenças';
  btn.addEventListener('click', () => openLicenses(company.id));
  head.appendChild(btn);
}

async function enforce() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!currentUser || !access) await resolveAccess();
    if (isSuper()) {
      retryCount = 0;
      document.querySelector('.cf-license-gate')?.remove();
      ensureNav();
      ensureCompanyButton();
    } else if (currentUser && retryCount < 6) {
      retryCount += 1;
      setTimeout(async () => { await resolveAccess(); enforce(); }, 350 * retryCount);
    }
  }, 70);
}

async function init() {
  retryCount = 0;
  await resolveAccess();
  enforce();
}

window.CondominioSuperAdminLicenses = { open: openLicenses, refreshAccess: init };
const observer = new MutationObserver(enforce);
observer.observe(document.documentElement,{childList:true,subtree:true});
supabase.auth.onAuthStateChange(() => setTimeout(init,120));
window.addEventListener('focus', () => setTimeout(init,80));
init();
