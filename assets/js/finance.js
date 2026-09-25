import { supabase } from './supabase.js';

let financeActive = false;
let financeCondo = null;
let financeCanManage = false;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const fmtDate = value => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';
const today = () => new Date().toISOString().slice(0,10);
const currentYear = () => new Date().getFullYear();
const currentMonth = () => new Date().getMonth() + 1;

const chargeTypeLabel = {
  monthly: 'Quota mensal', annual: 'Quota anual', extra: 'Quota extraordinária',
  reserve_fund: 'Fundo de reserva', penalty: 'Penalização', other: 'Outro'
};
const paymentMethodLabel = {
  transfer: 'Transferência', cash: 'Numerário', direct_debit: 'Débito direto',
  card: 'Cartão', mbway: 'MB Way', other: 'Outro'
};

function toast(message, error = false) {
  document.querySelector('.cf-finance-toast')?.remove();
  const node = document.createElement('div');
  node.className = `cf-finance-toast ${error ? 'error' : ''}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 4200);
}

async function getCurrentCondo() {
  const hero = document.querySelector('.condo-hero');
  const name = hero?.querySelector('h2')?.textContent?.trim();
  if (!name) return null;
  const { data, error } = await supabase.from('condominiums').select('id,name,address,city,company_id').eq('name', name);
  if (error) throw error;
  if (!data?.length) return null;
  if (data.length === 1) return data[0];
  const heroText = hero.textContent || '';
  return data.find(item => item.address && heroText.includes(item.address)) || data[0];
}

function restoreBaseContent() {
  const nav = document.querySelector('.module-tabs');
  if (!nav) return;
  let node = nav.nextElementSibling;
  while (node) {
    if (!node.classList.contains('cf-finance-host')) node.style.display = '';
    node = node.nextElementSibling;
  }
}

function leaveFinance() {
  if (!financeActive) return;
  financeActive = false;
  document.querySelector('.cf-finance-host')?.remove();
  restoreBaseContent();
}

document.addEventListener('click', event => {
  const tab = event.target.closest?.('.module-tab');
  if (financeActive && tab && !tab.classList.contains('cf-finance-tab')) leaveFinance();
}, true);

function closeModal(modal) { modal?.remove(); }
function modal(html) {
  const holder = document.createElement('div');
  holder.innerHTML = `<div class="cf-fin-modal-backdrop"><div class="cf-fin-modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const root = holder.firstElementChild;
  document.body.append(root);
  root.addEventListener('click', e => { if (e.target === root) closeModal(root); });
  root.querySelectorAll('[data-fin-close]').forEach(btn => btn.addEventListener('click', () => closeModal(root)));
  return root;
}

function monthOptions(selected = currentMonth(), includeAll = false) {
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${includeAll ? '<option value="0">Ano inteiro</option>' : ''}${names.map((name,i) => `<option value="${i+1}" ${Number(selected)===i+1?'selected':''}>${name}</option>`).join('')}`;
}

async function canManage(condoId) {
  const { data, error } = await supabase.rpc('can_manage_condo_finance', { p_condominium_id: condoId });
  if (error) return false;
  return Boolean(data);
}

async function loadFinanceData(condoId) {
  const [{ data: fractions, error: fErr }, { data: charges, error: cErr }, { data: payments, error: pErr }] = await Promise.all([
    supabase.from('fractions').select('id,code,floor,permillage,status').eq('condominium_id', condoId).order('code'),
    supabase.from('fraction_charges').select('*').eq('condominium_id', condoId).order('due_date', { ascending: false }),
    supabase.from('fraction_payments').select('*').eq('condominium_id', condoId).order('paid_on', { ascending: false })
  ]);
  if (fErr) throw fErr;
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  const chargeIds = (charges || []).map(x => x.id);
  const paymentIds = (payments || []).map(x => x.id);
  let allocations = [];
  if (chargeIds.length || paymentIds.length) {
    let q = supabase.from('payment_allocations').select('*');
    if (chargeIds.length) q = q.in('charge_id', chargeIds);
    else q = q.in('payment_id', paymentIds);
    const { data, error } = await q;
    if (error) throw error;
    allocations = data || [];
  }
  return { fractions: fractions || [], charges: charges || [], payments: payments || [], allocations };
}

function chargePaidMap(allocations) {
  const map = new Map();
  allocations.forEach(a => map.set(a.charge_id, (map.get(a.charge_id) || 0) + Number(a.amount || 0)));
  return map;
}

function chargeVisualStatus(charge, paid) {
  if (charge.status === 'cancelled') return { key: 'cancelled', label: 'Cancelada' };
  const remaining = Math.max(Number(charge.amount_due || 0) - paid, 0);
  if (remaining <= 0 || charge.status === 'paid') return { key: 'paid', label: 'Pago' };
  if (charge.due_date && charge.due_date < today()) return { key: 'overdue', label: paid > 0 ? 'Parcial em atraso' : 'Em atraso' };
  if (paid > 0 || charge.status === 'partial') return { key: 'partial', label: 'Parcial' };
  return { key: 'open', label: 'Em aberto' };
}

function filterData(data, filters) {
  const year = Number(filters.year);
  const month = Number(filters.month);
  const paidMap = chargePaidMap(data.allocations);
  let charges = data.charges.filter(c => Number(c.period_year) === year && (!month || Number(c.period_month) === month));
  if (filters.status !== 'all') {
    charges = charges.filter(c => chargeVisualStatus(c, paidMap.get(c.id) || 0).key === filters.status);
  }
  const payments = data.payments.filter(p => {
    const d = String(p.paid_on || '').split('-');
    return Number(d[0]) === year && (!month || Number(d[1]) === month);
  });
  return { charges, payments, paidMap };
}

function statusPill(status) { return `<span class="cf-fin-status ${status.key}">${esc(status.label)}</span>`; }

function summaryCards(filtered) {
  const activeCharges = filtered.charges.filter(c => c.status !== 'cancelled');
  const issued = activeCharges.reduce((s,c) => s + Number(c.amount_due || 0), 0);
  const received = filtered.payments.reduce((s,p) => s + Number(p.amount || 0), 0);
  const debt = activeCharges.reduce((s,c) => s + Math.max(Number(c.amount_due || 0) - (filtered.paidMap.get(c.id) || 0), 0), 0);
  const overdue = activeCharges.reduce((s,c) => {
    const paid = filtered.paidMap.get(c.id) || 0;
    const st = chargeVisualStatus(c, paid);
    return s + (st.key === 'overdue' ? Math.max(Number(c.amount_due || 0)-paid,0) : 0);
  },0);
  return `<div class="cf-fin-kpis">
    <article><span>Lançado</span><strong>${money(issued)}</strong><small>${activeCharges.length} movimento(s)</small></article>
    <article><span>Recebido</span><strong>${money(received)}</strong><small>${filtered.payments.length} pagamento(s)</small></article>
    <article><span>Em dívida</span><strong>${money(debt)}</strong><small>Saldo do período</small></article>
    <article class="${overdue > 0 ? 'danger' : ''}"><span>Em atraso</span><strong>${money(overdue)}</strong><small>Vencido e não liquidado</small></article>
  </div>`;
}

function chargesTable(filtered, fractionMap) {
  if (!filtered.charges.length) return '<div class="cf-fin-empty">Sem quotas/lançamentos para os filtros selecionados.</div>';
  return `<div class="cf-fin-table-wrap"><table class="cf-fin-table"><thead><tr><th>Fração</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Em dívida</th><th>Estado</th></tr></thead><tbody>${filtered.charges.map(c => {
    const paid = filtered.paidMap.get(c.id) || 0;
    const debt = Math.max(Number(c.amount_due || 0) - paid, 0);
    const status = chargeVisualStatus(c, paid);
    return `<tr><td><strong>${esc(fractionMap.get(c.fraction_id)?.code || '—')}</strong></td><td><strong>${esc(c.description)}</strong><small>${esc(chargeTypeLabel[c.charge_type] || c.charge_type)} · ${String(c.period_month).padStart(2,'0')}/${c.period_year}</small></td><td>${fmtDate(c.due_date)}</td><td>${money(c.amount_due)}</td><td>${money(paid)}</td><td>${money(debt)}</td><td>${statusPill(status)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function paymentsTable(filtered, fractionMap) {
  if (!filtered.payments.length) return '<div class="cf-fin-empty small">Sem pagamentos recebidos no período.</div>';
  return `<div class="cf-fin-table-wrap"><table class="cf-fin-table compact"><thead><tr><th>Data</th><th>Fração</th><th>Valor</th><th>Método</th><th>Referência</th></tr></thead><tbody>${filtered.payments.slice(0,50).map(p => `<tr><td>${fmtDate(p.paid_on)}</td><td><strong>${esc(fractionMap.get(p.fraction_id)?.code || '—')}</strong></td><td><strong>${money(p.amount)}</strong></td><td>${esc(paymentMethodLabel[p.method] || p.method)}</td><td>${esc(p.reference || '—')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function openBulkCharge(condo, fractions) {
  const now = new Date();
  const defaultDue = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-08`;
  const root = modal(`<header><div><span>FINANCEIRO</span><h2>Lançar quotas em massa</h2><p>Cria um lançamento para todas as frações ativas.</p></div><button data-fin-close>✕</button></header>
    <form class="cf-fin-form" id="cfBulkChargeForm">
      <label>Tipo<select name="charge_type"><option value="monthly">Quota mensal</option><option value="annual">Quota anual</option><option value="extra">Quota extraordinária</option><option value="reserve_fund">Fundo de reserva</option><option value="penalty">Penalização</option><option value="other">Outro</option></select></label>
      <label>Descrição<input name="description" value="Quota mensal" required></label>
      <label>Ano<input name="period_year" type="number" min="2000" max="2200" value="${currentYear()}" required></label>
      <label>Mês<select name="period_month">${monthOptions(currentMonth())}</select></label>
      <label>Data limite<input name="due_date" type="date" value="${defaultDue}" required></label>
      <label>Modo de cálculo<select name="mode" id="cfChargeMode"><option value="fixed">Mesmo valor por fração</option><option value="permillage">Distribuir total por permilagem</option></select></label>
      <label class="wide"><span id="cfAmountLabel">Valor por fração (€)</span><input name="amount" type="number" min="0.01" step="0.01" required></label>
      <div class="cf-fin-note wide">${fractions.filter(f=>f.status==='active').length} fração(ões) ativas. No modo por permilagem, o valor indicado é o total a distribuir.</div>
      <div class="cf-fin-actions wide"><button type="button" class="ghost-btn" data-fin-close>Cancelar</button><button type="submit" class="primary-btn">Lançar quotas</button></div>
    </form>`);
  root.querySelector('#cfChargeMode')?.addEventListener('change', e => {
    root.querySelector('#cfAmountLabel').textContent = e.target.value === 'permillage' ? 'Total a distribuir (€)' : 'Valor por fração (€)';
  });
  root.querySelector('#cfBulkChargeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'A lançar…';
    const v = Object.fromEntries(new FormData(e.currentTarget));
    const { data, error } = await supabase.rpc('create_bulk_fraction_charges', {
      p_condominium_id: condo.id,
      p_charge_type: v.charge_type,
      p_period_year: Number(v.period_year),
      p_period_month: Number(v.period_month),
      p_description: v.description.trim(),
      p_due_date: v.due_date,
      p_mode: v.mode,
      p_amount: Number(v.amount)
    });
    if (error) { btn.disabled=false; btn.textContent='Lançar quotas'; return toast(error.message,true); }
    closeModal(root);
    const result = data?.[0] || {};
    toast(`${result.created_count || 0} quota(s) criadas${result.skipped_count ? ` · ${result.skipped_count} já existiam` : ''}.`);
    await renderFinance(condo);
  });
}

async function openPayment(condo, fractions) {
  const active = fractions.filter(f => f.status === 'active');
  const root = modal(`<header><div><span>FINANCEIRO</span><h2>Registar pagamento</h2><p>O valor é aplicado automaticamente às dívidas mais antigas da fração.</p></div><button data-fin-close>✕</button></header>
    <form class="cf-fin-form" id="cfPaymentForm">
      <label>Fração<select name="fraction_id" required><option value="">Escolher…</option>${active.map(f=>`<option value="${f.id}">${esc(f.code)}${f.floor ? ` · Piso ${esc(f.floor)}` : ''}</option>`).join('')}</select></label>
      <label>Data<input name="paid_on" type="date" value="${today()}" required></label>
      <label>Valor (€)<input name="amount" type="number" min="0.01" step="0.01" required></label>
      <label>Método<select name="method"><option value="transfer">Transferência</option><option value="direct_debit">Débito direto</option><option value="cash">Numerário</option><option value="card">Cartão</option><option value="mbway">MB Way</option><option value="other">Outro</option></select></label>
      <label class="wide">Referência<input name="reference" placeholder="Ex.: TRF 2026-09 / recibo"></label>
      <label class="wide">Notas<textarea name="notes" rows="3"></textarea></label>
      <label class="cf-fin-check wide"><input name="auto_allocate" type="checkbox" checked> Abater automaticamente às quotas mais antigas em dívida</label>
      <div class="cf-fin-actions wide"><button type="button" class="ghost-btn" data-fin-close>Cancelar</button><button type="submit" class="primary-btn">Registar pagamento</button></div>
    </form>`);
  root.querySelector('#cfPaymentForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled=true; btn.textContent='A registar…';
    const fd = new FormData(e.currentTarget);
    const { data, error } = await supabase.rpc('register_fraction_payment', {
      p_condominium_id: condo.id,
      p_fraction_id: fd.get('fraction_id'),
      p_paid_on: fd.get('paid_on'),
      p_amount: Number(fd.get('amount')),
      p_method: fd.get('method'),
      p_reference: String(fd.get('reference') || ''),
      p_notes: String(fd.get('notes') || ''),
      p_auto_allocate: Boolean(fd.get('auto_allocate'))
    });
    if (error) { btn.disabled=false; btn.textContent='Registar pagamento'; return toast(error.message,true); }
    closeModal(root);
    const result = data?.[0] || {};
    const unallocated = Number(result.unallocated_amount || 0);
    toast(unallocated > 0 ? `Pagamento registado. ${money(unallocated)} ficou não alocado.` : 'Pagamento registado e aplicado às quotas.');
    await renderFinance(condo);
  });
}

async function renderFinance(condo) {
  const host = document.querySelector('.cf-finance-host');
  if (!host) return;
  host.innerHTML = '<div class="cf-fin-loading">A carregar financeiro…</div>';
  try {
    const data = await loadFinanceData(condo.id);
    const fractionMap = new Map(data.fractions.map(f => [f.id, f]));
    const prevYear = Number(host.dataset.year || currentYear());
    const prevMonth = Number(host.dataset.month ?? currentMonth());
    const prevStatus = host.dataset.status || 'all';
    const filters = { year: prevYear, month: prevMonth, status: prevStatus };
    const filtered = filterData(data, filters);
    host.innerHTML = `<section class="panel cf-fin-panel">
      <div class="panel-head cf-fin-head"><div><h2>Financeiro / Quotas</h2><p>Quotas, recebimentos e valores em atraso do condomínio.</p></div><div class="cf-fin-head-actions">${financeCanManage ? '<button class="ghost-btn compact" data-fin-payment>＋ Pagamento</button><button class="primary-btn compact" data-fin-bulk>＋ Lançar quotas</button>' : '<span class="cf-fin-readonly">Consulta da sua fração</span>'}</div></div>
      <div class="cf-fin-filters"><label>Ano<select data-fin-year>${[currentYear()-2,currentYear()-1,currentYear(),currentYear()+1].map(y=>`<option value="${y}" ${y===filters.year?'selected':''}>${y}</option>`).join('')}</select></label><label>Período<select data-fin-month>${monthOptions(filters.month,true)}</select></label><label>Estado<select data-fin-status><option value="all" ${filters.status==='all'?'selected':''}>Todos</option><option value="overdue" ${filters.status==='overdue'?'selected':''}>Em atraso</option><option value="open" ${filters.status==='open'?'selected':''}>Em aberto</option><option value="partial" ${filters.status==='partial'?'selected':''}>Parcial</option><option value="paid" ${filters.status==='paid'?'selected':''}>Pago</option><option value="cancelled" ${filters.status==='cancelled'?'selected':''}>Cancelado</option></select></label></div>
      ${summaryCards(filtered)}
      <div class="cf-fin-section-head"><div><h3>Quotas e lançamentos</h3><p>${filtered.charges.length} registo(s) no período</p></div></div>
      ${chargesTable(filtered, fractionMap)}
      <div class="cf-fin-section-head payments"><div><h3>Pagamentos recebidos</h3><p>Movimentos registados no período selecionado</p></div></div>
      ${paymentsTable(filtered, fractionMap)}
    </section>`;
    host.querySelector('[data-fin-bulk]')?.addEventListener('click', () => openBulkCharge(condo, data.fractions));
    host.querySelector('[data-fin-payment]')?.addEventListener('click', () => openPayment(condo, data.fractions));
    const rerender = () => {
      host.dataset.year = host.querySelector('[data-fin-year]').value;
      host.dataset.month = host.querySelector('[data-fin-month]').value;
      host.dataset.status = host.querySelector('[data-fin-status]').value;
      renderFinance(condo);
    };
    host.querySelectorAll('[data-fin-year],[data-fin-month],[data-fin-status]').forEach(el => el.addEventListener('change', rerender));
  } catch (error) {
    host.innerHTML = `<div class="cf-fin-empty">${esc(error.message || 'Não foi possível carregar o financeiro.')}</div>`;
  }
}

async function showFinance() {
  try {
    financeCondo = await getCurrentCondo();
    if (!financeCondo) throw new Error('Condomínio não identificado.');
    financeCanManage = await canManage(financeCondo.id);
    financeActive = true;
    const nav = document.querySelector('.module-tabs');
    if (!nav) return;
    nav.querySelectorAll('.module-tab').forEach(btn => btn.classList.remove('active'));
    nav.querySelector('.cf-finance-tab')?.classList.add('active');
    let host = document.querySelector('.cf-finance-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'cf-finance-host';
      nav.insertAdjacentElement('afterend', host);
    }
    host.style.display = '';
    let node = host.nextElementSibling;
    while (node) { node.style.display = 'none'; node = node.nextElementSibling; }
    const services = document.querySelector('.cf-services-host');
    if (services && services !== host) services.style.display = 'none';
    await renderFinance(financeCondo);
  } catch (error) { toast(error.message || 'Erro ao abrir o financeiro.', true); }
}

function injectFinanceTab() {
  const nav = document.querySelector('.module-tabs');
  if (!nav || nav.querySelector('.cf-finance-tab')) return;
  const btn = document.createElement('button');
  btn.className = 'module-tab cf-finance-tab';
  btn.textContent = 'Financeiro';
  btn.addEventListener('click', showFinance);
  nav.insertBefore(btn,nav.querySelector('[data-condo-tab=assemblies]'));
}

const observer = new MutationObserver(() => injectFinanceTab());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', injectFinanceTab);
setTimeout(injectFinanceTab, 700);
