import { supabase } from './supabase.js';

let enhancing = false;
let lastKey = '';

const money = value => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const today = () => new Date().toISOString().slice(0, 10);

function toast(message, error = false) {
  document.querySelector('.cf-fin-action-toast')?.remove();
  const node = document.createElement('div');
  node.className = `cf-fin-action-toast ${error ? 'error' : ''}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3800);
}

async function currentCondo() {
  const hero = document.querySelector('.condo-hero');
  const name = hero?.querySelector('h2')?.textContent?.trim();
  if (!name) return null;
  const { data, error } = await supabase.from('condominiums').select('id,name,address').eq('name', name);
  if (error) throw error;
  if (!data?.length) return null;
  if (data.length === 1) return data[0];
  const heroText = hero.textContent || '';
  return data.find(item => item.address && heroText.includes(item.address)) || data[0];
}

function paidMap(allocations) {
  const map = new Map();
  for (const item of allocations || []) {
    map.set(item.charge_id, (map.get(item.charge_id) || 0) + Number(item.amount || 0));
  }
  return map;
}

function visualStatus(charge, paid) {
  if (charge.status === 'cancelled') return 'cancelled';
  const remaining = Math.max(Number(charge.amount_due || 0) - Number(paid || 0), 0);
  if (remaining <= 0 || charge.status === 'paid') return 'paid';
  if (charge.due_date && charge.due_date < today()) return 'overdue';
  if (paid > 0 || charge.status === 'partial') return 'partial';
  return 'open';
}

async function loadVisibleCharges(condoId) {
  const host = document.querySelector('.cf-finance-host');
  if (!host) return [];
  const year = Number(host.querySelector('[data-fin-year]')?.value || new Date().getFullYear());
  const month = Number(host.querySelector('[data-fin-month]')?.value || 0);
  const statusFilter = host.querySelector('[data-fin-status]')?.value || 'all';

  const { data: charges, error } = await supabase
    .from('fraction_charges')
    .select('*')
    .eq('condominium_id', condoId)
    .order('due_date', { ascending: false });
  if (error) throw error;

  const ids = (charges || []).map(item => item.id);
  let allocations = [];
  if (ids.length) {
    const { data, error: allocationError } = await supabase
      .from('payment_allocations')
      .select('charge_id,amount')
      .in('charge_id', ids);
    if (allocationError) throw allocationError;
    allocations = data || [];
  }
  const map = paidMap(allocations);

  return (charges || []).filter(charge => {
    if (Number(charge.period_year) !== year) return false;
    if (month && Number(charge.period_month) !== month) return false;
    if (statusFilter !== 'all' && visualStatus(charge, map.get(charge.id) || 0) !== statusFilter) return false;
    return true;
  }).map(charge => ({
    ...charge,
    paid: map.get(charge.id) || 0,
    visual_status: visualStatus(charge, map.get(charge.id) || 0)
  }));
}

async function settle(charge, button) {
  const remaining = Math.max(Number(charge.amount_due || 0) - Number(charge.paid || 0), 0);
  if (remaining <= 0) return;
  const label = charge.visual_status === 'partial' || charge.paid > 0 ? 'Liquidar' : 'Marcar como pago';
  if (!confirm(`${label} esta quota no valor de ${money(remaining)}?`)) return;

  button.disabled = true;
  button.textContent = 'A processar…';
  const { error } = await supabase.rpc('settle_fraction_charge', {
    p_charge_id: charge.id,
    p_paid_on: today(),
    p_method: 'other'
  });
  if (error) {
    button.disabled = false;
    button.textContent = label;
    return toast(error.message || 'Não foi possível liquidar a quota.', true);
  }

  toast(`Quota liquidada: ${money(remaining)}.`);
  document.querySelector('.cf-finance-tab')?.click();
}

async function enhanceActions() {
  if (enhancing) return;
  const panel = document.querySelector('.cf-fin-panel');
  const table = panel?.querySelector('.cf-fin-table:not(.compact)');
  if (!panel || !table) return;

  const condo = await currentCondo();
  if (!condo) return;

  const { data: canManage, error: manageError } = await supabase.rpc('can_manage_condo_finance', { p_condominium_id: condo.id });
  if (manageError || !canManage) return;

  const key = `${condo.id}|${panel.querySelector('[data-fin-year]')?.value}|${panel.querySelector('[data-fin-month]')?.value}|${panel.querySelector('[data-fin-status]')?.value}|${table.querySelectorAll('tbody tr').length}`;
  if (table.dataset.cfActionsEnhanced === key && lastKey === key) return;

  enhancing = true;
  try {
    const charges = await loadVisibleCharges(condo.id);
    const headRow = table.querySelector('thead tr');
    if (headRow && !headRow.querySelector('.cf-fin-actions-head')) {
      const th = document.createElement('th');
      th.className = 'cf-fin-actions-head';
      th.textContent = 'Ações';
      headRow.append(th);
    }

    const rows = [...table.querySelectorAll('tbody tr')];
    rows.forEach(row => {
      row.querySelector('.cf-fin-actions-cell')?.remove();
      const charge = charges.find(item => item.id === row.dataset.chargeId);
      const td = document.createElement('td');
      td.className = 'cf-fin-actions-cell';

      if (!charge) {
        td.innerHTML = '<span class="cf-fin-action-muted">—</span>';
      } else if (charge.visual_status === 'paid') {
        td.innerHTML = '<span class="cf-fin-paid-check">✓ Pago</span>';
      } else if (charge.visual_status === 'cancelled') {
        td.innerHTML = '<span class="cf-fin-action-muted">Cancelada</span>';
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cf-fin-paid-btn';
        button.textContent = charge.visual_status === 'partial' || charge.paid > 0 ? 'Liquidar' : 'Marcar pago';
        button.addEventListener('click', () => settle(charge, button));
        td.append(button);
      }
      row.append(td);
    });

    table.dataset.cfActionsEnhanced = key;
    lastKey = key;
  } catch (error) {
    console.error('Finance actions:', error);
  } finally {
    enhancing = false;
  }
}

const observer = new MutationObserver(() => setTimeout(enhanceActions, 40));
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('change', event => {
  if (event.target.matches?.('[data-fin-year],[data-fin-month],[data-fin-status]')) setTimeout(enhanceActions, 120);
});
window.addEventListener('load', () => setTimeout(enhanceActions, 500));
setTimeout(enhanceActions, 900);
