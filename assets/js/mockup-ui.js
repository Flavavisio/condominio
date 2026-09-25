// Presentation layer for the approved desktop / resident design.
// All operational content comes from the existing access-scoped workspace.
export const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeHtml;
const paths = {
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  buildings:'M3 21V7l7-3v17M10 21V2l8 4v15M18 11l3 2v8M1 21h22M6 9v1m0 3v1m0 3v1m7-12v2m0 2v2m0 2v2m0 2v2',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.87a4 4 0 0 1 0 7.75',
  tool:'M14 6a5 5 0 0 0-6 6L2 18a2.8 2.8 0 0 0 4 4l6-6a5 5 0 0 0 6-6l-4 4-4-4 4-4Z',
  calendar:'M4 5h16v16H4ZM8 2v6m8-6v6M4 11h16',
  vote:'M4 14h3v7H4Zm6-5h3v12h-3Zm6-6h3v18h-3Z',
  document:'M5 2h9l5 5v15H5ZM14 2v6h5M9 12h6m-6 4h6',
  notice:'m3 9 13-5v16L3 15Zm13-2 4-2v10l-4-2M6 16l2 6h4l-2-5',
  briefcase:'M3 7h18v14H3ZM8 7V3h8v4M3 12h18M10 10v4h4v-4',
  chart:'M3 3v18h18M7 15l5-5 4 3 5-8',
  settings:'m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h4l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  search:'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  user:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2ZM12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  arrow:'M4 12h16m-6-6 6 6-6 6',
  chevron:'m9 5 7 7-7 7',
  down:'m6 9 6 6 6-6',
  plus:'M12 4v16M4 12h16',
  alert:'m12 3 10 18H2ZM12 9v5m0 3v1',
  check:'m5 12 4 4L19 6',
  drop:'M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13Z',
  shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6ZM8 12l3 3 5-6',
  pin:'M12 22s7-8 7-13a7 7 0 0 0-14 0c0 5 7 13 7 13ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  menu:'M3 6h18M3 12h18M3 18h18',
};
export const icon = name => `<svg class="cf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name] || paths.document).split('|||').map(d=>`<path d="${d}"/>`).join('')}</svg>`;
export const brand = () => `<span class="cf-building-logo" aria-hidden="true"><svg viewBox="0 0 54 54"><path d="M4 46V23l12-6v30M16 47V7L31 1v48" fill="none" stroke="#0b3b5c" stroke-width="3"/><path d="m31 3 7 5v41l-7-1Z" fill="#0b3b5c"/><path d="m40 17 11 6v28l-11-2Z" fill="#227f99"/><path d="M3 48 31 46l21 6H3Z" fill="#1a5f7a"/><path d="M21 10v31" stroke="#b3d5e3" stroke-width="4"/></svg></span><span class="cf-brand-copy"><strong>Condomia</strong><small>Condomínio fácil</small></span>`;
export const labels = {dashboard:'Visão geral',condominiums:'Condomínios',fractions:'Frações e condóminos',operations:'Ocorrências',maintenance:'Manutenções',assemblies:'Assembleias',votes:'Votações',documents:'Documentos',notices:'Avisos',reservations:'Reservas',suppliers:'Fornecedores',reports:'Relatórios',settings:'Configurações',profile:'Perfil',agenda:'Agenda',companies:'Empresas gestoras',obligations:'Obrigações'};
const menu = [['dashboard','Dashboard','home'],['condominiums','Condomínios','buildings'],['fractions','Frações e condóminos','users'],['operations','Ocorrências','tool'],['maintenance','Manutenções','calendar'],['assemblies','Assembleias','users'],['votes','Votações','vote'],['documents','Documentos','document'],['notices','Avisos','notice'],['reservations','Reservas','calendar'],['suppliers','Fornecedores','briefcase'],['reports','Relatórios','chart']];
const nameFor = s => s.profile?.full_name || s.user?.email || 'Utilizador';
const firstName = s => nameFor(s).split(' ')[0];
const initials = name => name.split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
const nav = (s,id,label,ic) => `<button type="button" class="nav-item ${s.view===id?'active':''}" data-view="${id}" ${s.view===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span></button>`;
export function scopedCondos(s) { return s.condominiums.filter(c=>(!s.dashboardCompanyId||c.company_id===s.dashboardCompanyId)&&(!s.dashboardCondoId||c.id===s.dashboardCondoId)); }
export function scopedItems(s,key) { const ids=new Set(scopedCondos(s).map(c=>c.id));return (s[key]||[]).filter(i=>ids.has(i.condominium_id)); }
const condoName = (s,id) => s.condominiums.find(c=>c.id===id)?.name||'Condomínio';
const fmtDate = v => v ? new Date(String(v).length===10?`${v}T12:00:00`:v).toLocaleDateString('pt-PT',{day:'numeric',month:'short',year:'numeric'}) : 'Sem data';
export const issueLabel = status => ({open:'Aberto',analysis:'Em análise',scheduled:'Técnico chamado',progress:'Em reparação',resolved:'Resolvido',closed:'Resolvido',cancelled:'Cancelado'}[status]||status||'Aberto');
export const issueDisplayLabel = issue => issue.approval_status==='pending'?'A aguardar aprovação':issue.approval_status==='rejected'?'Rejeitada pelo administrador':issueLabel(issue.status);
const pill = issue => `<span class="cf-status ${e(issue.status)}">${e(issueDisplayLabel(issue))}</span>`;
const compactEmpty = text => `<p class="cf-empty">${e(text)}</p>`;
export function shell(s,content,{resident=false,superAdmin=false,title=''}={}) {
  const company=s.companies.find(c=>c.id===s.dashboardCompanyId)||s.companies[0];
  const sidebarMenu=menu.filter(([id])=>!['fractions','operations','maintenance','assemblies','votes','documents'].includes(id));
  const links=superAdmin?[['dashboard','Dashboard','home'],['companies','Empresas gestoras','buildings']]:resident?[['dashboard','Resumo','home'],['operations','Ocorrências','tool'],['notices','Avisos','notice'],['assemblies','Assembleias','users'],['votes','Votações','vote'],['resident-finance','Financeiro','chart']]:sidebarMenu;
  return `<div class="app-shell mockup-shell ${resident?'cf-resident-shell':''}">
    <aside class="sidebar"><a class="cf-brand" href="#" data-view="dashboard" aria-label="Condomia — Início">${brand()}</a>
      ${!resident&&!superAdmin?`<label class="cf-company-switch"><span>Empresa gestora</span><select id="companyFilter" aria-label="Empresa gestora">${s.companies.length>1?`<option value="">Todas as empresas</option>`:''}${s.companies.map(c=>`<option value="${e(c.id)}" ${s.dashboardCompanyId===c.id||(!s.dashboardCompanyId&&s.companies.length===1)?'selected':''}>${e(c.label||c.name)}</option>`).join('')}${!s.companies.length?'<option>Sem empresa associada</option>':''}</select></label>`:''}
      <nav aria-label="Menu principal">${links.map(args=>nav(s,...args)).join('')}</nav>
      <div class="cf-sidebar-bottom">${resident?'':nav(s,'settings','Configurações','settings')}</div>
    </aside><button type="button" class="cf-menu-backdrop" aria-label="Fechar menu" id="closeSidebar"></button>
    <main class="main"><header class="topbar"><div class="cf-topbar-title"><button type="button" class="cf-menu-toggle icon-btn" id="menuToggle" aria-label="Abrir menu" aria-expanded="false">${icon('menu')}</button><h1>${e(title||(resident&&s.view==='dashboard'?'Resumo':s.view==='resident-finance'?'Financeiro':labels[s.view])||'Visão geral')}</h1>${superAdmin?'<span class="eyebrow blue cf-role-context">Super Admin</span>':''}</div>
      <a class="cf-brand cf-mobile-brand" href="#" data-view="dashboard">${brand()}</a>
      <div class="cf-header-right">${!superAdmin&&!resident?`<form id="globalSearch" class="cf-search" role="search">${icon('search')}<input name="q" aria-label="Pesquisar" placeholder="Pesquisar..." value="${e(s.searchQuery||'')}" autocomplete="off"></form>`:''}<div class="topbar-actions"></div><button class="cf-account" type="button" data-view="profile"><span class="avatar">${e(initials(nameFor(s)))}</span><span>${e(nameFor(s))}</span>${icon('down')}</button></div>
    </header><div class="cf-content"><div id="flash">${s.error||s.info?`<div role="status" class="flash ${s.error?'error':'success'}">${e(s.error||s.info)}</div>`:''}</div>${content}</div></main>
    ${resident?`<nav class="cf-mobile-nav" aria-label="Navegação do condómino">${[['dashboard','Início','home'],['operations','Ocorrências','tool'],['notices','Avisos','notice'],['resident-finance','Pagamento','chart']].map(args=>nav(s,...args)).join('')}</nav>`:''}
  </div><div id="modalHost"></div>`;
}
function filter(s) {return `<select id="condoFilter" aria-label="Filtrar condomínio"><option value="">Todos os condomínios</option>${s.condominiums.filter(c=>!s.dashboardCompanyId||c.company_id===s.dashboardCompanyId).map(c=>`<option value="${e(c.id)}" ${s.dashboardCondoId===c.id?'selected':''}>${e(c.name)}</option>`).join('')}</select>`;}
const sectionHead=(title,view,label='Ver todos')=>`<div class="panel-head"><h2>${title}</h2><button class="text-btn" data-view="${view}">${label} ${icon('arrow')}</button></div>`;
function issueRow(s,i) {
  const tone=['resolved','closed'].includes(i.status)?'green':['urgent','high'].includes(i.priority)?'red':'blue';
  return `<tr><td><button class="cf-issue-link" data-condo="${e(i.condominium_id)}" data-tab="issues"><span class="cf-round-icon ${tone}">${icon(tone==='green'?'check':tone==='red'?'alert':'drop')}</span><span><strong>${e(i.title)}</strong><small>${e(i.place||'Local por definir')} · ${e(fmtDate(i.created_at))}</small></span></button></td><td>${e(condoName(s,i.condominium_id))}</td><td>${pill(i)}</td><td><button class="cf-more" aria-label="Abrir ocorrência: ${e(i.title)}" data-condo="${e(i.condominium_id)}" data-tab="issues">⋮</button></td></tr>`;
}
export function agendaItems(s) {
  return [...scopedItems(s,'assemblies').filter(i=>i.status==='scheduled'&&new Date(i.scheduled_for)>=new Date()).map(i=>({...i,when:i.scheduled_for,tab:'assemblies',ic:'users'})),...scopedItems(s,'maintenance').filter(i=>i.scheduled_for&&!['done','cancelled'].includes(i.status)).map(i=>({...i,when:i.scheduled_for,tab:'maintenance',ic:'tool'})),...scopedItems(s,'obligations').filter(i=>i.active&&i.next_date).map(i=>({...i,when:i.next_date,tab:'obligations',ic:'shield'}))].sort((a,b)=>a.when.localeCompare(b.when));
}
export function agenda(s,limit=3) {
  const items=agendaItems(s).slice(0,limit);
  return items.length?`<div class="cf-agenda">${items.map(i=>{const dt=new Date(i.when.length===10?`${i.when}T12:00:00`:i.when);return `<button class="cf-agenda-item" ${i.tab==='assemblies'?`data-assembly="${e(i.id)}"`:`data-condo="${e(i.condominium_id)}" data-tab="${i.tab}"`}><span class="cf-calendar-date"><strong>${dt.getDate()}</strong><small>${dt.toLocaleDateString('pt-PT',{month:'short'}).replace('.','').toUpperCase()}</small></span>${icon(i.ic)}<span><strong>${e(i.title)}</strong><small>${i.when.length>10?dt.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}):'Todo o dia'}</small><small class="cf-location">${icon('pin')}${e(condoName(s,i.condominium_id))}</small></span></button>`;}).join('')}</div>`:compactEmpty('Sem eventos agendados.');
}
export function buildingPicture(index=0,extra='') {return `<div role="img" aria-label="Imagem ilustrativa de edifício" class="cf-building-photo cf-building-photo-${index%3} ${extra}"></div>`;}
export function condoCards(s) {return scopedCondos(s).length?`<div class="cf-condo-cards">${scopedCondos(s).slice(0,3).map((c,i)=>`<button data-condo="${e(c.id)}">${buildingPicture(i)}<strong>${e(c.name)}</strong><small>${s.fractions.filter(f=>f.condominium_id===c.id).length||Number(c.fractions_count)||0} frações</small></button>`).join('')}</div>`:compactEmpty('Ainda não existem condomínios.');}
function updates(s) {
  const items=[...scopedItems(s,'documents').map(i=>({...i,title:i.name,kind:'document',view:'documents',when:i.created_at})),...scopedItems(s,'notices').map(i=>({...i,kind:'notice',view:'notices',when:i.published_at}))].sort((a,b)=>String(b.when).localeCompare(String(a.when))).slice(0,3);
  return items.length?`<div class="cf-updates">${items.map((i,n)=>`<button ${i.kind==='document'?`data-document="${e(i.id)}"`:`data-condo="${e(i.condominium_id)}" data-tab="notices"`}><span class="cf-square-icon ${i.kind==='notice'?'coral':n===2?'green':'blue'}">${icon(i.kind)}</span><span><strong>${e(i.title)}</strong><small>${i.kind==='notice'?'Aviso':'Documento'} · ${e(fmtDate(i.when))}</small></span>${icon('chevron')}</button>`).join('')}</div>`:compactEmpty('Sem avisos ou documentos publicados.');
}
export function dashboard(s) {
  const condos=scopedCondos(s), issues=scopedItems(s,'issues');
  const open=issues.filter(i=>!['resolved','closed','cancelled'].includes(i.status));
  const urgent=open.filter(i=>['urgent','high'].includes(i.priority));
  const fractions=condos.reduce((n,c)=>n+(s.fractions.filter(f=>f.condominium_id===c.id).length||Number(c.fractions_count)||0),0);
  const metrics=[['Condomínios',condos.length,'buildings','blue'],['Frações',fractions,'users','green'],['Ocorrências abertas',open.length,'tool','amber'],['Assembleias agendadas',scopedItems(s,'assemblies').filter(a=>a.status==='scheduled'&&new Date(a.scheduled_for)>=new Date()).length,'calendar','blue']];
  return `<section class="cf-welcome"><div><h2>Olá, ${e(firstName(s))}</h2><p>Tudo o que precisa de acompanhar, num só lugar.</p></div><div class="cf-welcome-actions">${filter(s)}<button class="primary-btn" data-new-issue>${icon('plus')}Nova ocorrência</button></div></section>
    <section class="cf-metrics">${metrics.map(([label,value,ic,tone])=>`<article class="cf-metric" ><span class="cf-square-icon ${tone}">${icon(ic)}</span><div><strong>${value}</strong><span>${label}</span></div></article>`).join('')}</section>
    <section class="cf-attention ${urgent.length?'':'cf-clear'}">${icon(urgent.length?'alert':'check')}<strong>${urgent.length?`${urgent.length} ${urgent.length===1?'ocorrência urgente precisa':'ocorrências urgentes precisam'} de atenção.`:'Não existem ocorrências urgentes.'}</strong><button data-view="operations">Ver ocorrências ${icon('arrow')}</button></section>
    <section class="cf-dashboard-main"><article class="panel cf-occurrences">${sectionHead('Ocorrências recentes','operations','Ver todas')}<div class="table-wrap"><table class="cf-issues-table"><thead><tr><th>Ocorrência</th><th>Condomínio</th><th>Estado</th><th></th></tr></thead><tbody>${issues.slice(0,3).map(i=>issueRow(s,i)).join('')}</tbody></table>${!issues.length?compactEmpty('Ainda não foram reportadas ocorrências.'):''}</div></article><article class="panel">${sectionHead('Agenda','agenda','Ver agenda')}${agenda(s)}</article></section>
    <section class="cf-dashboard-bottom"><article class="panel">${sectionHead('Os seus condomínios','condominiums')}${condoCards(s)}</article><article class="panel">${sectionHead('Avisos e documentos','documents')}${updates(s)}</article></section>`;
}
export function resident(s) {
  const memberships=s.condominiumMembers.filter(m=>m.user_id===s.user.id&&m.status==='active');
  const condo=s.condominiums.find(c=>c.id===s.residentCondoId)||s.condominiums.find(c=>c.id===memberships[0]?.condominium_id);
  const member=memberships.find(m=>m.condominium_id===condo?.id);
  const fraction=s.fractions.find(f=>f.id===member?.fraction_id);
  const nextAssembly=(s.assemblies||[]).filter(a=>a.condominium_id===condo?.id&&a.status==='scheduled'&&new Date(a.scheduled_for)>=new Date()).sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for))[0];
  const admin=memberships.some(m=>m.condominium_id===condo?.id&&m.is_condominium_admin);
  const pending=s.issues.filter(i=>i.condominium_id===condo?.id&&i.approval_status==='pending');
  const mine=s.issues.find(i=>i.condominium_id===condo?.id&&i.reporter_user_id===s.user.id);
  return `<div class="cf-resident-dashboard"><section class="cf-resident-hero"><div><h2>Olá, ${e(firstName(s))}</h2><p>${e(condo?.name||'O meu condomínio')}${fraction?` · Fração ${e(fraction.code)}`:''}</p>${memberships.length>1?`<select id="residentCondo" aria-label="O meu condomínio">${s.condominiums.filter(c=>memberships.some(m=>m.condominium_id===c.id)).map(c=>`<option value="${e(c.id)}" ${condo?.id===c.id?'selected':''}>${e(c.name)}</option>`).join('')}</select>`:''}</div><div class="cf-resident-building" role="img" aria-label="Imagem ilustrativa de edifício"></div></section>
      <button class="primary-btn cf-report" data-view="resident-finance">${icon('chart')}Pagamento do condomínio</button><button class="ghost-btn cf-report" data-new-issue data-resident-condo="${e(condo?.id||'')}">${icon('tool')}Reportar avaria</button>
      ${admin?`<section class="cf-attention"><strong>Administrador do condomínio · ${pending.length} por aprovar</strong><button data-condo="${e(condo?.id)}" data-tab="issues">Rever ocorrências ${icon('arrow')}</button></section>`:''}<section class="cf-resident-shortcuts">${[['notices','Avisos','notice'],['assemblies','Assembleias','users'],['votes','Votações','vote'],['resident-finance','Financeiro','chart']].map(([id,label,ic])=>`<button data-resident-route="${id}" data-resident-condo="${e(condo?.id||'')}">${icon(ic)}<span>${label}</span></button>`).join('')}</section>
      <article class="panel cf-my-issue"><div class="panel-head"><h2>A minha ocorrência</h2><button class="text-btn" data-view="operations" aria-label="Ver ocorrências">${icon('chevron')}</button></div>${mine?`<button class="cf-resident-issue" data-condo="${e(mine.condominium_id)}" data-tab="issues"><span class="cf-round-icon blue">${icon('drop')}</span><span><strong>${e(mine.title)}</strong>${pill(mine)}<small>${mine.approval_status==='pending'?'Aguarda a aprovação do administrador do condomínio.':mine.approval_status==='rejected'?'Consulte o motivo indicado pelo administrador.':mine.status==='progress'?'O técnico está a tratar do problema.':mine.status==='resolved'?'O problema foi resolvido.':'Acompanhe aqui o estado do seu pedido.'}</small></span></button>`:compactEmpty('Ainda não reportou ocorrências.')}</article>
      <article class="panel cf-next-assembly"><div class="panel-head"><h2>Próxima assembleia</h2><button class="text-btn" data-view="assemblies" aria-label="Ver assembleias">${icon('chevron')}</button></div><div class="cf-assembly-empty">${icon('calendar')}<span>${nextAssembly?`${e(nextAssembly.title)}<br>${e(fmtDate(nextAssembly.scheduled_for))} · ${e(new Date(nextAssembly.scheduled_for).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}))}<br>${e(nextAssembly.location)}`:'Sem assembleias agendadas.'}</span></div>${nextAssembly?`<button class="primary-btn" data-assembly="${e(nextAssembly.id)}">Ver convocatória</button>`:''}</article></div>`;
}

export function superDashboard(s) {
 const rows=s.companyStats||[];
 const columns=[['condominiums','Condomínios'],['fractions','Frações'],['team','Equipa'],['issues','Ocorrências'],['assemblies','Assembleias'],['polls','Votações']];
 return `<section class="cf-welcome"><div><h2>Visão da plataforma</h2><p>Quantidades por empresa gestora.</p></div></section>
 <section class="cf-metrics">${[['Empresas gestoras',s.companies.length,'buildings'],...columns.slice(0,3).map(([key,label])=>[label,rows.reduce((sum,r)=>sum+r[key],0),'users'])].map(([label,value,ic])=>`<article class="cf-metric"><span class="cf-square-icon blue">${icon(ic)}</span><div><strong>${value}</strong><span>${label}</span></div></article>`).join('')}</section>
 <section class="panel"><div class="panel-head"><h2>Empresas gestoras</h2></div><div class="table-wrap"><table class="cf-company-quantities"><thead><tr><th>Empresa</th>${columns.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${s.companies.map(c=>{const stats=rows.find(r=>r.company_id===c.id);return `<tr><td><strong>${e(c.label||c.name)}</strong></td>${columns.map(([key])=>`<td>${stats?Number(stats[key]):'—'}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div>${!s.companies.length?compactEmpty('Ainda não existem empresas gestoras.'):''}</section>`;
}
