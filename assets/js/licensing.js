import { supabase } from './supabase.js';
import {planFields,bindPlanFields,planSummary,enrichLicensePlans} from './plans.js';

let access = null;
let currentUser = null;
let currentAdminCompany = null;
let timer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';

function toast(message, error = false) {
  document.querySelector('.cf-license-toast')?.remove();
  const el = document.createElement('div');
  el.className = `cf-license-toast ${error ? 'error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function overlay(html, cls = 'cf-license-overlay') {
  document.querySelector(`.${cls}`)?.remove();
  const root = document.createElement('div');
  root.className = cls;
  root.innerHTML = html;
  document.body.appendChild(root);
  root.querySelectorAll('[data-license-close]').forEach(btn => btn.addEventListener('click', () => root.remove()));
  root.addEventListener('click', e => { if (e.target === root) root.remove(); });
  return root;
}

function effectiveState(row) {
  if (!row) return { key: 'missing', label: 'Sem licença' };
  if (row.status !== 'active') return { key: row.status, label: ({suspended:'Suspensa',expired:'Expirada',cancelled:'Cancelada'})[row.status] || row.status };
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(`${row.expires_on}T00:00:00`);
  const days = Math.ceil((expiry - today) / 86400000);
  if (days < 0) return { key: 'expired', label: 'Expirada' };
  if (days <= 7) return { key: 'warning', label: `Expira em ${days} dia${days === 1 ? '' : 's'}` };
  return { key: 'active', label: 'Ativa' };
}

async function resolveIdentity() {
  const { data: sessionData } = await supabase.auth.getSession();
  currentUser = sessionData?.session?.user || null;
  access = null;
  currentAdminCompany = null;
  if (!currentUser) {
    document.querySelector('.cf-license-banner')?.remove();
    return;
  }
  const { data } = await supabase.rpc('get_my_access_context').maybeSingle();
  access = data || null;
  if (access?.is_super_admin) return;
  const { data: memberships } = await supabase.from('company_members').select('company_id,role,status').eq('user_id', currentUser.id).eq('status','active').eq('role','admin').limit(1);
  if (memberships?.[0]) currentAdminCompany = memberships[0].company_id;
}

function injectSuperAdminNav() {
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;
  if (!access?.is_super_admin) {
    nav.querySelector('.cf-license-nav')?.remove();
    return;
  }
  if (nav.querySelector('.cf-license-nav, .cf-license-nav-authority')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item cf-license-nav';
  btn.innerHTML = '<span>◇</span>Licenças';
  btn.addEventListener('click', openLicenses);
  const companies = [...nav.querySelectorAll('.nav-item')].find(item => item.textContent.includes('Empresas gestoras'));
  if (companies?.nextSibling) nav.insertBefore(btn, companies.nextSibling); else nav.append(btn);
}

async function injectAdminLicenseBanner() {
  if (document.querySelector('.mockup-shell') && !document.querySelector('.cf-settings-license')) return;
  if (document.querySelector('.cf-license-banner')) return;
  if (!currentUser || access?.is_super_admin || !currentAdminCompany) return;
  const { data } = await supabase.from('company_admin_licenses').select('id,billing_cycle,starts_on,expires_on,status,license_key,plan_id,condominium_limit,monthly_price').eq('company_id', currentAdminCompany).eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(1);
  const license = data?.[0] || null;
  const state = effectiveState(license);
  const main = document.querySelector('.main');
  const topbar = document.querySelector('.topbar');
  if (!main || !topbar || document.querySelector('.cf-license-banner')) return;
  const banner = document.createElement('div');
  banner.className = `cf-license-banner ${state.key}`;
  banner.innerHTML = license ? `<div><strong>Licença ${esc(state.label)}</strong><small>${esc(planSummary(license))}</small><span>${license.billing_cycle === 'annual' ? 'Anual' : 'Mensal'} · válida até ${fmt(license.expires_on)}</span></div><b>${esc(license.license_key)}</b>` : `<div><strong>Sem licença ativa</strong><span>O Super Admin precisa de emitir uma licença mensal ou anual para esta conta de administrador.</span></div><b>ACESSO ADMINISTRATIVO BLOQUEADO</b>`;
  const settings = document.querySelector('.cf-settings-license');
  if (settings) settings.append(banner); else topbar.insertAdjacentElement('afterend', banner);
}

async function loadLicenseData() {
  const [{ data: admins, error: adminError }, { data: licenses, error: licenseError }] = await Promise.all([
    supabase.rpc('list_company_admins_for_licensing'),
    supabase.rpc('list_company_admin_licenses')
  ]);
  if (adminError) throw adminError;
  if (licenseError) throw licenseError;
  return { admins: admins || [], licenses: await enrichLicensePlans(supabase,licenses) };
}

function latestFor(admin, licenses) {
  return licenses.find(l => l.company_id === admin.company_id && l.user_id === admin.user_id) || null;
}

function licenseRow(admin, license) {
  const state = effectiveState(license);
  const cycle = license?.billing_cycle === 'annual' ? 'Anual' : license?.billing_cycle === 'monthly' ? 'Mensal' : '—';
  return `<tr>
    <td><strong>${esc(admin.company_name)}</strong><small>${esc(planSummary(license))}</small></td>
    <td><strong>${esc(admin.full_name)}</strong><small>${esc(admin.email)}</small></td>
    <td>${cycle}</td>
    <td>${license ? fmt(license.starts_on) : '—'}</td>
    <td>${license ? fmt(license.expires_on) : '—'}</td>
    <td><span class="cf-license-pill ${state.key}">${esc(state.label)}</span></td>
    <td class="cf-license-actions">
      ${!license || ['cancelled','expired'].includes(state.key) ? `<button data-license-issue="${admin.company_id}|${admin.user_id}">Emitir</button>` : ''}
      ${license && !['cancelled'].includes(state.key) ? `<button data-license-renew="${license.id}">Renovar</button>` : ''}
      ${license?.status === 'active' ? `<button class="danger" data-license-status="${license.id}|suspended">Suspender</button>` : ''}
      ${license?.status === 'suspended' ? `<button data-license-status="${license.id}|active">Reativar</button>` : ''}
    </td>
  </tr>`;
}

async function openLicenses() {
  try {
    const ctx = await loadLicenseData();
    const active = ctx.admins.filter(a => effectiveState(latestFor(a,ctx.licenses)).key === 'active').length;
    const warning = ctx.admins.filter(a => effectiveState(latestFor(a,ctx.licenses)).key === 'warning').length;
    const without = ctx.admins.length - active - warning;
    const root = overlay(`<section class="cf-license-page">
      <header><div><span>SUPER ADMIN</span><h2>Licenciamento</h2><p>Licenças mensais e anuais dos administradores das empresas gestoras.</p></div><button data-license-close>✕</button></header>
      <div class="cf-license-kpis"><div><strong>${ctx.admins.length}</strong><span>Administradores</span></div><div><strong>${active}</strong><span>Licenças ativas</span></div><div><strong>${warning}</strong><span>A expirar ≤ 7 dias</span></div><div><strong>${without}</strong><span>Sem licença / bloqueadas</span></div></div>
      <div class="cf-license-table-wrap"><table class="cf-license-table"><thead><tr><th>Empresa</th><th>Administrador</th><th>Ciclo</th><th>Início</th><th>Fim</th><th>Estado</th><th>Ações</th></tr></thead><tbody>${ctx.admins.length ? ctx.admins.map(a => licenseRow(a,latestFor(a,ctx.licenses))).join('') : '<tr><td colspan="7">Ainda não existem administradores de empresas gestoras.</td></tr>'}</tbody></table></div>
    </section>`);
    root.querySelectorAll('[data-license-issue]').forEach(btn => btn.addEventListener('click', () => {
      const [companyId,userId] = btn.dataset.licenseIssue.split('|');
      const admin = ctx.admins.find(a => a.company_id === companyId && a.user_id === userId);
      openIssue(admin);
    }));
    root.querySelectorAll('[data-license-renew]').forEach(btn => btn.addEventListener('click', () => openRenew(btn.dataset.licenseRenew)));
    root.querySelectorAll('[data-license-status]').forEach(btn => btn.addEventListener('click', async () => {
      const [id,status] = btn.dataset.licenseStatus.split('|');
      if (!confirm(status === 'suspended' ? 'Suspender esta licença?' : 'Reativar esta licença?')) return;
      const { error } = await supabase.rpc('set_company_admin_license_status',{p_license_id:id,p_status:status});
      if (error) return toast(error.message,true);
      toast(status === 'suspended' ? 'Licença suspensa.' : 'Licença reativada.');
      root.remove(); await openLicenses();
    }));
  } catch (error) { toast(error.message || 'Não foi possível abrir as licenças.', true); }
}

function openIssue(admin) {
  if (!admin) return;
  const root = overlay(`<section class="cf-license-modal"><header><div><span>EMITIR LICENÇA</span><h2>${esc(admin.company_name)}</h2><p>${esc(admin.full_name)} · ${esc(admin.email)}</p></div><button data-license-close>✕</button></header><form id="cfLicenseIssueForm">
    ${planFields()}
    <label>Ciclo<select name="cycle"><option value="monthly">Mensal</option><option value="annual">Anual</option></select></label>
    <label>Data de início<input name="starts" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label class="wide">Notas<textarea name="notes" rows="3" placeholder="Opcional"></textarea></label>
    <div class="actions wide"><button type="button" data-license-close>Cancelar</button><button class="primary" type="submit">Emitir licença</button></div>
  </form></section>`,'cf-license-modal-backdrop');
  bindPlanFields(root);
  root.querySelector('#cfLicenseIssueForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled=true; button.textContent='A emitir…';
    const { error } = await supabase.rpc('issue_planned_company_license',{p_company_id:admin.company_id,p_user_id:admin.user_id,p_billing_cycle:fd.get('cycle'),p_starts_on:fd.get('starts'),p_plan_id:fd.get('plan_id'),p_notes:fd.get('notes') || null});
    if (error) { button.disabled=false; button.textContent='Emitir licença'; return toast(error.message,true); }
    root.remove(); document.querySelector('.cf-license-overlay')?.remove(); toast('Licença emitida com sucesso.'); await openLicenses();
  });
}

function openRenew(id) {
  const root = overlay(`<section class="cf-license-modal"><header><div><span>RENOVAR</span><h2>Renovar licença</h2><p>Escolha o novo período a acrescentar.</p></div><button data-license-close>✕</button></header><form id="cfLicenseRenewForm"><label class="wide">Ciclo<select name="cycle"><option value="monthly">+ 1 mês</option><option value="annual">+ 1 ano</option></select></label><div class="actions wide"><button type="button" data-license-close>Cancelar</button><button class="primary" type="submit">Renovar</button></div></form></section>`,'cf-license-modal-backdrop');
  root.querySelector('#cfLicenseRenewForm').addEventListener('submit', async e => {
    e.preventDefault(); const fd=new FormData(e.currentTarget);
    const { error } = await supabase.rpc('renew_company_admin_license',{p_license_id:id,p_billing_cycle:fd.get('cycle')});
    if (error) return toast(error.message,true);
    root.remove(); document.querySelector('.cf-license-overlay')?.remove(); toast('Licença renovada.'); await openLicenses();
  });
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { injectSuperAdminNav(); injectAdminLicenseBanner(); }, 80);
}

async function initialize() { await resolveIdentity(); schedule(); }
const observer = new MutationObserver(schedule);
observer.observe(document.documentElement,{childList:true,subtree:true});
supabase.auth.onAuthStateChange(() => setTimeout(initialize,100));
initialize();
