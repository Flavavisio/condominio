import { supabase } from './supabase.js';
import {planFields,bindPlanFields,planSummary,enrichLicensePlans} from './plans.js';

let access = null;
let timer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const fmt = value => value ? new Intl.DateTimeFormat('pt-PT',{dateStyle:'medium'}).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';

function toast(message, error = false) {
  document.querySelector('.cf-license-management-toast')?.remove();
  const node = document.createElement('div');
  node.className = `cf-license-toast cf-license-management-toast ${error ? 'error' : ''}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

async function resolveAccess() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) { access = null; return; }
  const { data, error } = await supabase.rpc('get_my_access_context').maybeSingle();
  access = error ? null : data;
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

function latestLicense(admin, licenses) {
  return licenses.find(item => item.company_id === admin.company_id && item.user_id === admin.user_id) || null;
}

function stateOf(license) {
  if (!license) return { key:'missing', label:'Sem licença' };
  if (license.status !== 'active') return { key:license.status, label:({ suspended:'Suspensa', expired:'Expirada', cancelled:'Cancelada' })[license.status] || license.status };
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(`${license.expires_on}T00:00:00`);
  if (expiry < today) return { key:'expired', label:'Expirada' };
  const days = Math.ceil((expiry - today) / 86400000);
  return days <= 7 ? { key:'warning', label:`Expira em ${days} dia${days === 1 ? '' : 's'}` } : { key:'active', label:'Ativa' };
}

function closeAdvanced() {
  document.querySelector('.cf-license-advanced-overlay')?.remove();
}

function advancedOverlay(html) {
  closeAdvanced();
  const root = document.createElement('div');
  root.className = 'cf-license-overlay cf-license-advanced-overlay';
  root.innerHTML = html;
  document.body.appendChild(root);
  root.querySelectorAll('[data-lm-close]').forEach(btn => btn.addEventListener('click', closeAdvanced));
  root.addEventListener('click', event => { if (event.target === root) closeAdvanced(); });
  return root;
}

async function issueLicense(admin, afterSave) {
  const root = advancedOverlay(`<section class="cf-license-modal"><header><div><span>EMITIR LICENÇA</span><h2>${esc(admin.company_name)}</h2><p>${esc(admin.full_name)} · ${esc(admin.email)}</p></div><button data-lm-close>✕</button></header><form data-lm-form>
    ${planFields()}
    <label>Ciclo<select name="cycle"><option value="monthly">Mensal</option><option value="annual">Anual</option></select></label>
    <label>Data de início<input name="starts" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label class="wide">Notas<textarea name="notes" rows="3" placeholder="Opcional"></textarea></label>
    <div class="actions wide"><button type="button" data-lm-close>Cancelar</button><button class="primary" type="submit">Emitir licença</button></div>
  </form></section>`);
  bindPlanFields(root);
  root.querySelector('[data-lm-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'A emitir…';
    const { error } = await supabase.rpc('issue_planned_company_license', {
      p_company_id: admin.company_id,
      p_user_id: admin.user_id,
      p_billing_cycle: fd.get('cycle'),
      p_starts_on: fd.get('starts'),
      p_plan_id: fd.get('plan_id'),
      p_notes: fd.get('notes') || null
    });
    if (error) { button.disabled = false; button.textContent = 'Emitir licença'; return toast(error.message, true); }
    closeAdvanced();
    toast('Licença emitida com sucesso.');
    await afterSave?.();
  });
}

async function editLicense(license, afterSave) {
  const root = advancedOverlay(`<section class="cf-license-modal"><header><div><span>EDITAR LICENÇA</span><h2>${esc(license.company_name || 'Licença')}</h2><p>${esc(license.full_name || license.email || '')}</p></div><button data-lm-close>✕</button></header><form data-lm-form>
    ${planFields(license.plan_id)}
    <label>Ciclo<select name="cycle"><option value="monthly" ${license.billing_cycle === 'monthly' ? 'selected' : ''}>Mensal</option><option value="annual" ${license.billing_cycle === 'annual' ? 'selected' : ''}>Anual</option></select></label>
    <label>Início<input name="starts" type="date" value="${esc(license.starts_on || '')}" required></label>
    <label>Fim<input name="expires" type="date" value="${esc(license.expires_on || '')}" required></label>
    <label class="wide">Notas<textarea name="notes" rows="3">${esc(license.notes || '')}</textarea></label>
    <div class="actions wide"><button type="button" data-lm-close>Cancelar</button><button class="primary" type="submit">Guardar alterações</button></div>
  </form></section>`);
  bindPlanFields(root);
  root.querySelector('[data-lm-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const { error } = await supabase.rpc('update_planned_company_license', {
      p_license_id: license.id,
      p_billing_cycle: fd.get('cycle'),
      p_starts_on: fd.get('starts'),
      p_expires_on: fd.get('expires'),
      p_plan_id: fd.get('plan_id'),
      p_notes: fd.get('notes') || null
    });
    if (error) return toast(error.message, true);
    closeAdvanced();
    toast('Licença atualizada.');
    await afterSave?.();
  });
}

async function renewLicense(license, afterSave) {
  const root = advancedOverlay(`<section class="cf-license-modal"><header><div><span>RENOVAR LICENÇA</span><h2>${esc(license.company_name || 'Licença')}</h2><p>Escolha o período a acrescentar.</p></div><button data-lm-close>✕</button></header><form data-lm-form>
    <label class="wide">Renovação<select name="cycle"><option value="monthly">+ 1 mês</option><option value="annual">+ 1 ano</option></select></label>
    <div class="actions wide"><button type="button" data-lm-close>Cancelar</button><button class="primary" type="submit">Renovar</button></div>
  </form></section>`);
  root.querySelector('[data-lm-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const { error } = await supabase.rpc('renew_company_admin_license', { p_license_id: license.id, p_billing_cycle: fd.get('cycle') });
    if (error) return toast(error.message, true);
    closeAdvanced();
    toast('Licença renovada.');
    await afterSave?.();
  });
}

async function changeStatus(license, status, afterSave) {
  const labels = { suspended:'Suspender', active:'Reativar', cancelled:'Cancelar' };
  const question = status === 'cancelled' ? 'Cancelar definitivamente esta licença?' : `${labels[status]} esta licença?`;
  if (!confirm(question)) return;
  const { error } = await supabase.rpc('set_company_admin_license_status', { p_license_id: license.id, p_status: status });
  if (error) return toast(error.message, true);
  toast(status === 'active' ? 'Licença reativada.' : status === 'suspended' ? 'Licença suspensa.' : 'Licença cancelada.');
  await afterSave?.();
}

function actionButtons(admin, license) {
  const state = stateOf(license);
  if (!license || ['cancelled','expired'].includes(state.key)) {
    return `<button data-lm-issue="${admin.company_id}|${admin.user_id}">Emitir</button>${license ? `<button data-lm-edit="${license.id}">Editar</button><button data-lm-renew="${license.id}">Renovar</button>` : ''}`;
  }
  return `<button data-lm-edit="${license.id}">Editar</button><button data-lm-renew="${license.id}">Renovar</button>${license.status === 'active' ? `<button class="danger" data-lm-status="${license.id}|suspended">Suspender</button>` : ''}${license.status === 'suspended' ? `<button data-lm-status="${license.id}|active">Reativar</button>` : ''}<button class="danger" data-lm-status="${license.id}|cancelled">Cancelar</button>`;
}

async function openCompanyLicenses(companyId = null) {
  if (!access?.is_super_admin) return;
  try {
    const ctx = await loadData();
    const admins = companyId ? ctx.admins.filter(item => item.company_id === companyId) : ctx.admins;
    const companyName = admins[0]?.company_name || 'Todas as empresas';
    const root = advancedOverlay(`<section class="cf-license-page">
      <header><div><span>SUPER ADMIN</span><h2>Gestão de licenças</h2><p>${esc(companyId ? companyName : 'Licenças dos administradores das empresas gestoras')}</p></div><button data-lm-close>✕</button></header>
      <div class="cf-license-table-wrap" style="padding-top:22px"><table class="cf-license-table"><thead><tr><th>Empresa</th><th>Administrador</th><th>Ciclo</th><th>Início</th><th>Fim</th><th>Estado</th><th>Ações</th></tr></thead><tbody>${admins.length ? admins.map(admin => { const license = latestLicense(admin, ctx.licenses); const state = stateOf(license); return `<tr><td><strong>${esc(admin.company_name)}</strong><small>${esc(planSummary(license))}</small></td><td><strong>${esc(admin.full_name)}</strong><small>${esc(admin.email)}</small></td><td>${license ? (license.billing_cycle === 'annual' ? 'Anual' : 'Mensal') : '—'}</td><td>${license ? fmt(license.starts_on) : '—'}</td><td>${license ? fmt(license.expires_on) : '—'}</td><td><span class="cf-license-pill ${state.key}">${esc(state.label)}</span></td><td class="cf-license-actions">${actionButtons(admin, license)}</td></tr>`; }).join('') : '<tr><td colspan="7">Esta empresa ainda não tem administradores.</td></tr>'}</tbody></table></div>
    </section>`);
    const refresh = async () => openCompanyLicenses(companyId);
    root.querySelectorAll('[data-lm-issue]').forEach(btn => btn.addEventListener('click', () => { const [c,u] = btn.dataset.lmIssue.split('|'); const admin = ctx.admins.find(item => item.company_id === c && item.user_id === u); issueLicense(admin, refresh); }));
    root.querySelectorAll('[data-lm-edit]').forEach(btn => btn.addEventListener('click', () => { const license = ctx.licenses.find(item => item.id === btn.dataset.lmEdit); editLicense(license, refresh); }));
    root.querySelectorAll('[data-lm-renew]').forEach(btn => btn.addEventListener('click', () => { const license = ctx.licenses.find(item => item.id === btn.dataset.lmRenew); renewLicense(license, refresh); }));
    root.querySelectorAll('[data-lm-status]').forEach(btn => btn.addEventListener('click', () => { const [id,status] = btn.dataset.lmStatus.split('|'); const license = ctx.licenses.find(item => item.id === id); changeStatus(license, status, refresh); }));
  } catch (error) {
    toast(error.message || 'Não foi possível abrir a gestão de licenças.', true);
  }
}

async function injectCompanyLicenseButton() {
  if (!access?.is_super_admin) return;
  const modal = document.querySelector('.admin-company-modal');
  if (!modal || modal.querySelector('[data-lm-company]')) return;
  const title = modal.querySelector('.company-head h2')?.textContent?.trim();
  if (!title) return;
  const { data: companies, error } = await supabase.from('companies').select('id,name,label');
  if (error) return;
  const company = (companies || []).find(item => (item.label || item.name) === title || item.name === title);
  if (!company) return;
  const section = [...modal.querySelectorAll('.admin-card')].find(card => card.querySelector('h3')?.textContent?.includes('Utilizadores da empresa'));
  const head = section?.querySelector('.admin-section-head');
  if (!head) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-secondary';
  button.dataset.lmCompany = company.id;
  button.textContent = 'Gerir licenças';
  button.addEventListener('click', () => openCompanyLicenses(company.id));
  head.appendChild(button);
}

async function enhanceGlobalLicensePage() {
  if (!access?.is_super_admin) return;
  const page = document.querySelector('.cf-license-page');
  if (!page || page.querySelector('[data-lm-full]')) return;
  const header = page.querySelector('header');
  if (!header) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.lmFull = '1';
  button.textContent = 'Gestão completa';
  button.style.width = 'auto';
  button.style.padding = '0 12px';
  button.addEventListener('click', () => openCompanyLicenses());
  header.insertBefore(button, header.lastElementChild);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    injectCompanyLicenseButton();
    enhanceGlobalLicensePage();
  }, 90);
}

async function init() {
  await resolveAccess();
  schedule();
}

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList:true, subtree:true });
supabase.auth.onAuthStateChange(() => setTimeout(init, 120));
init();
