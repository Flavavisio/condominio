import { supabase } from './supabase.js';

let checking = false;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value ? new Intl.DateTimeFormat('pt-PT',{dateStyle:'medium'}).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';

function validLicense(row) {
  if (!row || row.status !== 'active') return false;
  const today = new Date().toISOString().slice(0,10);
  return String(row.starts_on) <= today && String(row.expires_on) >= today;
}

function removeGate() {
  document.querySelector('.cf-license-gate')?.remove();
}

function showGate(company, license) {
  removeGate();
  const root = document.createElement('div');
  root.className = 'cf-license-gate';
  const state = !license ? 'Sem licença emitida' : license.status === 'suspended' ? 'Licença suspensa' : license.status === 'cancelled' ? 'Licença cancelada' : 'Licença expirada';
  root.innerHTML = `<section>
    <div class="cf-license-gate-mark">CF</div>
    <span>CONDOMÍNIO FÁCIL</span>
    <h1>${esc(state)}</h1>
    <p>A conta de administrador da empresa <strong>${esc(company?.label || company?.name || 'gestora')}</strong> necessita de uma licença mensal ou anual ativa emitida pelo Super Admin.</p>
    ${license ? `<div class="cf-license-gate-meta"><div><small>Tipo</small><strong>${license.billing_cycle === 'annual' ? 'Anual' : 'Mensal'}</strong></div><div><small>Validade</small><strong>${fmt(license.expires_on)}</strong></div></div>` : ''}
    <div class="cf-license-gate-actions"><button type="button" data-license-recheck>Verificar licença</button><button type="button" class="danger" data-license-logout>Terminar sessão</button></div>
  </section>`;
  document.body.appendChild(root);
  root.querySelector('[data-license-recheck]')?.addEventListener('click', () => checkLicenseGate(true));
  root.querySelector('[data-license-logout]')?.addEventListener('click', async () => { await supabase.auth.signOut(); removeGate(); });
}

async function checkLicenseGate(force = false) {
  if (checking && !force) return;
  checking = true;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) { removeGate(); return; }

    const { data: access } = await supabase.rpc('get_my_access_context').maybeSingle();
    if (access?.is_super_admin) { removeGate(); return; }

    const { data: memberships, error: memberError } = await supabase
      .from('company_members')
      .select('company_id,role,status')
      .eq('user_id',user.id)
      .eq('role','admin')
      .eq('status','active');
    if (memberError || !memberships?.length) { removeGate(); return; }

    const companyIds = memberships.map(m => m.company_id);
    const [{ data: licenses }, { data: companies }] = await Promise.all([
      supabase.from('company_admin_licenses').select('id,company_id,user_id,billing_cycle,starts_on,expires_on,status').eq('user_id',user.id).in('company_id',companyIds).order('created_at',{ascending:false}),
      supabase.from('companies').select('id,name,label').in('id',companyIds)
    ]);

    const latestByCompany = new Map();
    for (const license of licenses || []) if (!latestByCompany.has(license.company_id)) latestByCompany.set(license.company_id, license);
    const activeCompany = companyIds.find(id => validLicense(latestByCompany.get(id)));
    if (activeCompany) { removeGate(); return; }

    const companyId = companyIds[0];
    const company = (companies || []).find(c => c.id === companyId);
    showGate(company, latestByCompany.get(companyId) || null);
  } finally {
    checking = false;
  }
}

supabase.auth.onAuthStateChange(() => setTimeout(() => checkLicenseGate(true),120));
window.addEventListener('load', () => checkLicenseGate(true));
setTimeout(() => checkLicenseGate(true),700);
