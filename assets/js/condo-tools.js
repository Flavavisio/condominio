import { supabase } from './supabase.js';

const condoCache = new Map();
let activeCustomTab = false;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(message, error = false) {
  document.querySelector('.cf-tool-toast')?.remove();
  const el = document.createElement('div');
  el.className = `cf-tool-toast ${error ? 'error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function addDays(dateValue, days) {
  const d = new Date(`${dateValue}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextDateFor(frequency, from) {
  const map = {
    'Diária': 1,
    'Diario': 1,
    'Semanal': 7,
    'Quinzenal': 14,
    'Mensal': 30,
    'Bimestral': 60,
    'Trimestral': 90,
    'Semestral': 182,
    'Anual': 365
  };
  return addDays(from, map[frequency] || 7);
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`));
}

async function currentCondo() {
  const hero = document.querySelector('.condo-hero');
  const title = hero?.querySelector('h2')?.textContent?.trim();
  if (!title) return null;
  if (condoCache.has(title)) return condoCache.get(title);
  const { data, error } = await supabase.from('condominiums').select('id,name,address,city,company_id').eq('name', title);
  if (error) throw error;
  if (!data?.length) return null;
  let match = data[0];
  const heroText = hero.textContent || '';
  if (data.length > 1) match = data.find(item => item.address && heroText.includes(item.address)) || data[0];
  condoCache.set(title, match);
  return match;
}

function canUseXlsx() {
  if (!window.XLSX) {
    toast('Biblioteca Excel ainda não carregou. Atualize a página.', true);
    return false;
  }
  return true;
}

function workbookFromRows(rows, sheetName = 'Frações') {
  const ws = XLSX.utils.json_to_sheet(rows, { header: ['Fração','Piso','Permilagem','Estado'] });
  ws['!cols'] = [{wch:20},{wch:12},{wch:14},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

async function exportFractions() {
  if (!canUseXlsx()) return;
  try {
    const condo = await currentCondo();
    if (!condo) throw new Error('Condomínio não identificado.');
    const { data, error } = await supabase.from('fractions').select('code,floor,permillage,status').eq('condominium_id', condo.id).order('code');
    if (error) throw error;
    const rows = (data || []).map(item => ({
      'Fração': item.code,
      'Piso': item.floor || '',
      'Permilagem': item.permillage ?? '',
      'Estado': item.status === 'inactive' ? 'Inativa' : 'Ativa'
    }));
    if (!rows.length) rows.push({'Fração':'Ex.: A','Piso':'R/C','Permilagem':100,'Estado':'Ativa'});
    XLSX.writeFile(workbookFromRows(rows), `fracoes-${condo.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.xlsx`);
  } catch (error) {
    toast(error.message || 'Não foi possível exportar.', true);
  }
}

function downloadTemplate() {
  if (!canUseXlsx()) return;
  const rows = [
    {'Fração':'A','Piso':'R/C','Permilagem':85.5,'Estado':'Ativa'},
    {'Fração':'B','Piso':'R/C','Permilagem':82.5,'Estado':'Ativa'},
    {'Fração':'1.º Esq.','Piso':'1','Permilagem':110,'Estado':'Ativa'}
  ];
  XLSX.writeFile(workbookFromRows(rows), 'modelo-importacao-fracoes.xlsx');
}

function normaliseKey(key) {
  return String(key || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
}

function valueBy(row, keys) {
  const entries = Object.entries(row || {});
  for (const wanted of keys) {
    const match = entries.find(([key]) => normaliseKey(key) === wanted);
    if (match) return match[1];
  }
  return '';
}

async function importFractions(file) {
  if (!canUseXlsx() || !file) return;
  try {
    const condo = await currentCondo();
    if (!condo) throw new Error('Condomínio não identificado.');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) throw new Error('O ficheiro não contém linhas para importar.');

    const payload = [];
    const invalid = [];
    rows.forEach((row, index) => {
      const code = String(valueBy(row, ['fracao','codigo','code'])).trim();
      if (!code) { invalid.push(index + 2); return; }
      const floor = String(valueBy(row, ['piso','floor'])).trim() || null;
      const rawPerm = valueBy(row, ['permilagem','permillage']);
      const numberPerm = rawPerm === '' ? null : Number(String(rawPerm).replace(',','.'));
      const rawStatus = normaliseKey(valueBy(row, ['estado','status']));
      payload.push({
        condominium_id: condo.id,
        code,
        floor,
        permillage: Number.isFinite(numberPerm) ? numberPerm : null,
        status: ['inativa','inactive','inativo'].includes(rawStatus) ? 'inactive' : 'active'
      });
    });

    if (!payload.length) throw new Error('Nenhuma fração válida encontrada.');
    const { error } = await supabase.from('fractions').upsert(payload, { onConflict: 'condominium_id,code' });
    if (error) throw error;
    toast(`${payload.length} fração(ões) importadas/atualizadas${invalid.length ? ` · ${invalid.length} linha(s) ignoradas` : ''}.`);
    document.querySelector('#reloadBtn')?.click();
  } catch (error) {
    toast(error.message || 'Erro ao importar Excel.', true);
  }
}

function injectFractionTools() {
  const panels = [...document.querySelectorAll('.panel')];
  const panel = panels.find(p => p.querySelector('.panel-head h2')?.textContent?.trim() === 'Frações');
  if (!panel || panel.querySelector('.cf-fraction-tools')) return;
  const head = panel.querySelector('.panel-head');
  if (!head) return;
  const box = document.createElement('div');
  box.className = 'cf-fraction-tools';
  box.innerHTML = `
    <button class="ghost-btn compact" data-cf-template>Modelo Excel</button>
    <button class="ghost-btn compact" data-cf-export>Exportar Excel</button>
    <button class="primary-btn compact" data-cf-import>Importar Excel</button>
    <input type="file" data-cf-file accept=".xlsx,.xls" hidden>`;
  head.appendChild(box);
  box.querySelector('[data-cf-template]').addEventListener('click', downloadTemplate);
  box.querySelector('[data-cf-export]').addEventListener('click', exportFractions);
  const file = box.querySelector('[data-cf-file]');
  box.querySelector('[data-cf-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    await importFractions(file.files?.[0]);
    file.value = '';
  });
}

function serviceForm(condo, suppliers) {
  return `
    <div class="cf-modal-backdrop" data-cf-close>
      <div class="cf-modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="cf-modal-head"><div><span>Serviço periódico</span><h2>Novo serviço</h2></div><button type="button" data-cf-close>✕</button></div>
        <form class="cf-service-form">
          <label class="wide">Descrição<input name="title" required placeholder="Limpeza das escadas e patamares"></label>
          <label>Tipo<select name="service_type"><option>Limpeza</option><option>Jardinagem</option><option>Piscina</option><option>Controlo de pragas</option><option>Garagens</option><option>Resíduos</option><option>Áreas comuns</option><option>Outro</option></select></label>
          <label>Zona<input name="area" placeholder="Blocos A e B"></label>
          <label>Frequência<select name="frequency"><option>Diária</option><option selected>Semanal</option><option>Quinzenal</option><option>Mensal</option><option>Bimestral</option><option>Trimestral</option><option>Semestral</option><option>Anual</option></select></label>
          <label>Dia habitual<select name="weekday"><option value="">—</option><option>Segunda-feira</option><option>Terça-feira</option><option>Quarta-feira</option><option>Quinta-feira</option><option>Sexta-feira</option><option>Sábado</option><option>Domingo</option></select></label>
          <label>Hora<input name="time_of_day" type="time"></label>
          <label>Próxima execução<input name="next_service_on" type="date"></label>
          <label>Fornecedor<select name="supplier_id"><option value="">Sem fornecedor</option>${suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
          <label>Duração prevista (min)<input name="estimated_minutes" type="number" min="0" step="15"></label>
          <label class="wide">Notas<textarea name="notes" rows="3"></textarea></label>
          <div class="cf-modal-actions"><button type="button" class="ghost-btn" data-cf-close>Cancelar</button><button type="submit" class="primary-btn">Guardar serviço</button></div>
        </form>
      </div>
    </div>`;
}

function historyModal(service, visits) {
  return `
    <div class="cf-modal-backdrop" data-cf-close>
      <div class="cf-modal" onclick="event.stopPropagation()">
        <div class="cf-modal-head"><div><span>Histórico</span><h2>${esc(service.title)}</h2></div><button type="button" data-cf-close>✕</button></div>
        <div class="cf-history-list">${visits.length ? visits.map(v => `<div class="cf-history-row"><div><strong>${formatDate(v.performed_on)}</strong><small>${esc(v.performed_by || 'Sem responsável')}</small></div><span>${esc(v.result)}</span><p>${esc(v.notes || '')}</p></div>`).join('') : '<div class="cf-empty">Sem execuções registadas.</div>'}</div>
      </div>
    </div>`;
}

function bindClose(root) {
  root.querySelectorAll('[data-cf-close]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('.cf-modal') && !e.target.matches('[data-cf-close]')) return;
    root.remove();
  }));
}

async function openServiceForm(condo) {
  const { data: suppliers, error } = await supabase.from('suppliers').select('id,name').eq('condominium_id', condo.id).eq('status','active').order('name');
  if (error) return toast(error.message, true);
  const host = document.createElement('div');
  host.innerHTML = serviceForm(condo, suppliers || []);
  const modal = host.firstElementChild;
  document.body.appendChild(modal);
  bindClose(modal);
  modal.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!values.supplier_id) delete values.supplier_id;
    if (!values.next_service_on) delete values.next_service_on;
    if (!values.time_of_day) delete values.time_of_day;
    values.estimated_minutes = values.estimated_minutes ? Number(values.estimated_minutes) : null;
    values.condominium_id = condo.id;
    const { error: saveError } = await supabase.from('periodic_services').insert(values);
    if (saveError) return toast(saveError.message, true);
    modal.remove();
    toast('Serviço periódico criado.');
    renderServices(condo);
  });
}

async function markServiceDone(service, condo) {
  const notes = prompt('Notas da execução (opcional):', '') ?? null;
  if (notes === null) return;
  const today = new Date().toISOString().slice(0,10);
  const { data: { user } } = await supabase.auth.getUser();
  const { error: visitError } = await supabase.from('periodic_service_visits').insert({
    periodic_service_id: service.id,
    condominium_id: condo.id,
    performed_on: new Date().toISOString(),
    performed_by: user?.email || null,
    result: 'done',
    notes: notes || null
  });
  if (visitError) return toast(visitError.message, true);
  const { error: updateError } = await supabase.from('periodic_services').update({
    last_service_on: today,
    next_service_on: nextDateFor(service.frequency, today)
  }).eq('id', service.id);
  if (updateError) return toast(updateError.message, true);
  toast('Execução registada e próxima data atualizada.');
  renderServices(condo);
}

async function showHistory(service) {
  const { data, error } = await supabase.from('periodic_service_visits').select('*').eq('periodic_service_id', service.id).order('performed_on', { ascending: false });
  if (error) return toast(error.message, true);
  const holder = document.createElement('div');
  holder.innerHTML = historyModal(service, data || []);
  const modal = holder.firstElementChild;
  document.body.appendChild(modal);
  bindClose(modal);
}

async function toggleService(service, condo) {
  const { error } = await supabase.from('periodic_services').update({ active: !service.active }).eq('id', service.id);
  if (error) return toast(error.message, true);
  renderServices(condo);
}

async function renderServices(condo) {
  const host = document.querySelector('.cf-services-host');
  if (!host) return;
  host.innerHTML = '<div class="cf-loading">A carregar serviços…</div>';
  const [{data: services, error}, {data: suppliers}] = await Promise.all([
    supabase.from('periodic_services').select('*').eq('condominium_id', condo.id).order('next_service_on', { ascending: true, nullsFirst: false }),
    supabase.from('suppliers').select('id,name').eq('condominium_id', condo.id)
  ]);
  if (error) { host.innerHTML = `<div class="cf-empty">${esc(error.message)}</div>`; return; }
  const supplierMap = new Map((suppliers || []).map(s => [s.id, s.name]));
  host.innerHTML = `
    <section class="panel cf-services-panel">
      <div class="panel-head"><div><h2>Serviços periódicos</h2><p>Limpeza, jardinagem, piscina e outros serviços recorrentes do edifício.</p></div><button class="primary-btn compact" data-cf-new-service>＋ Novo serviço</button></div>
      ${services?.length ? `<div class="cf-service-grid">${services.map(s => `
        <article class="cf-service-card ${s.active ? '' : 'paused'}">
          <div class="cf-service-top"><span>${esc(s.service_type)}</span><b>${s.active ? 'Ativo' : 'Pausado'}</b></div>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.area || 'Zona não definida')}</p>
          <div class="cf-service-meta"><span><small>Frequência</small><strong>${esc(s.frequency)}</strong></span><span><small>Próxima</small><strong>${formatDate(s.next_service_on)}</strong></span><span><small>Fornecedor</small><strong>${esc(supplierMap.get(s.supplier_id) || '—')}</strong></span></div>
          <div class="cf-service-actions"><button class="ghost-btn compact" data-cf-history="${s.id}">Histórico</button><button class="ghost-btn compact" data-cf-toggle="${s.id}">${s.active ? 'Pausar' : 'Reativar'}</button>${s.active ? `<button class="primary-btn compact" data-cf-done="${s.id}">✓ Executado</button>` : ''}</div>
        </article>`).join('')}</div>` : '<div class="cf-empty">Ainda não existem serviços periódicos. Crie, por exemplo, a limpeza semanal do edifício.</div>'}
    </section>`;
  host.querySelector('[data-cf-new-service]')?.addEventListener('click', () => openServiceForm(condo));
  for (const service of services || []) {
    host.querySelector(`[data-cf-done="${service.id}"]`)?.addEventListener('click', () => markServiceDone(service, condo));
    host.querySelector(`[data-cf-history="${service.id}"]`)?.addEventListener('click', () => showHistory(service));
    host.querySelector(`[data-cf-toggle="${service.id}"]`)?.addEventListener('click', () => toggleService(service, condo));
  }
}

async function showServices() {
  try {
    const condo = await currentCondo();
    if (!condo) throw new Error('Condomínio não identificado.');
    activeCustomTab = true;
    const nav = document.querySelector('.module-tabs');
    if (!nav) return;
    nav.querySelectorAll('.module-tab').forEach(btn => btn.classList.remove('active'));
    nav.querySelector('.cf-services-tab')?.classList.add('active');
    let host = document.querySelector('.cf-services-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'cf-services-host';
      nav.insertAdjacentElement('afterend', host);
    }
    let sibling = host.nextElementSibling;
    while (sibling) { sibling.dataset.cfHiddenByServices = '1'; sibling.style.display = 'none'; sibling = sibling.nextElementSibling; }
    await renderServices(condo);
  } catch (error) {
    toast(error.message || 'Erro ao abrir serviços.', true);
  }
}

function injectServicesTab() {
  const nav = document.querySelector('.module-tabs');
  if (!nav || nav.querySelector('.cf-services-tab')) return;
  const btn = document.createElement('button');
  btn.className = 'module-tab cf-services-tab';
  btn.textContent = 'Serviços';
  btn.addEventListener('click', showServices);
  nav.appendChild(btn);
  nav.querySelectorAll('.module-tab:not(.cf-services-tab)').forEach(original => original.addEventListener('click', () => { activeCustomTab = false; }));
}

function enhance() {
  injectServicesTab();
  injectFractionTools();
}

const observer = new MutationObserver(() => {
  if (!activeCustomTab) enhance();
  else injectServicesTab();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', enhance);
setTimeout(enhance, 700);
