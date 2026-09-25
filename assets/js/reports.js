import { supabase } from './supabase.js';
import { pollResults } from './api.js';
import { issueDisplayLabel } from './mockup-ui.js';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(v).toLocaleDateString('pt-PT'):'—';
const cents=v=>Math.round(Number(v||0)*100);
const money=v=>(v/100).toLocaleString('pt-PT',{style:'currency',currency:'EUR'});
const labels={open:'Aberta',partial:'Parcial',paid:'Paga',cancelled:'Cancelada',scheduled:'Agendada',completed:'Concluída',active:'Ativo',inactive:'Inativo',draft:'Rascunho',closed:'Encerrada',published:'Publicada',yes:'A favor',no:'Contra',abstain:'Abstenção',transfer:'Transferência',cash:'Numerário',direct_debit:'Débito direto',card:'Cartão',mbway:'MB WAY',other:'Outro',urgent:'Urgente',high:'Alta',normal:'Normal',low:'Baixa'};
const label=v=>labels[v]||v||'—';
let scope='',selected='',data=null,loading=false,error='',generation=0;
const tables=['fractions','condominium_members','issues','notices','documents','suppliers','equipment','maintenance','obligations','obligation_inspections','assemblies','polls','periodic_services','periodic_service_visits','fraction_charges','fraction_payments','payment_allocations','obligation_checklist_items'];
export async function loadReport(id){
 const entries=await Promise.all(tables.map(async name=>{
  const rows=[];
  for(let start=0;;start+=1000){
   const join=name==='payment_allocations'?'fraction_charges':name==='obligation_checklist_items'?'obligations':null;
   const {data:page,error}=await supabase.from(name).select(join?`*,${join}!inner(condominium_id)`:'*').eq(join?`${join}.condominium_id`:'condominium_id',id).order('id').range(start,start+999);
   if(error)throw new Error(`Não foi possível carregar ${name}: ${error.message}`);
   rows.push(...page);if(page.length<1000)break;
  }
  return [name,rows];
 }));
 const report=Object.fromEntries(entries);
 report.results=Object.fromEntries(await Promise.all(report.polls.map(async p=>[p.id,await pollResults(p.id)])));
 report.generatedAt=new Date().toISOString();return report;
}
function table(title,headers,rows){return `<section class="cr-section"><h3>${esc(title)} <small>(${rows.length})</small></h3>${rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="cr-muted">Sem registos.</p>'}</section>`;}
export function financialSummary(d,today){
 const allocations=new Map();for(const a of d.payment_allocations)allocations.set(a.charge_id,(allocations.get(a.charge_id)||0)+cents(a.amount));
 const charges=d.fraction_charges.filter(c=>c.status!=='cancelled');
 const totals=items=>items.reduce((t,c)=>{const paid=allocations.get(c.id)||0,left=Math.max(0,cents(c.amount_due)-paid);t.charged+=cents(c.amount_due);t.paid+=paid;t.outstanding+=left;if(c.due_date&&c.due_date<today)t.overdue+=left;return t;},{charged:0,paid:0,outstanding:0,overdue:0});
 const result=totals(charges);result.receipts=d.fraction_payments.reduce((n,p)=>n+cents(p.amount),0);result.unallocated=result.receipts-d.payment_allocations.reduce((n,a)=>n+cents(a.amount),0);
 return {...result,byFraction:d.fractions.map(f=>({fraction:f,...totals(charges.filter(c=>c.fraction_id===f.id))}))};
}
export function reportMarkup(condo,d){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d.generatedAt));
 const part=k=>parts.find(p=>p.type===k).value;const total=financialSummary(d,`${part('year')}-${part('month')}-${part('day')}`);
 const fraction=id=>d.fractions.find(f=>f.id===id)?.code||'—';const supplier=id=>d.suppliers.find(s=>s.id===id)?.name||'—';const obligation=id=>d.obligations.find(o=>o.id===id)?.title||'—';
 const members=d.condominium_members.filter(m=>m.status==='active');
 const stats=[['Frações',d.fractions.length],['Contas ativas',new Set(members.map(m=>m.user_id)).size],['Administradores',new Set(members.filter(m=>m.is_condominium_admin).map(m=>m.user_id)).size],['Ocorrências',d.issues.length],['Assembleias',d.assemblies.length],['Votações',d.polls.length]];
 return `<article class="cr-report"><header><p class="cr-brand">CONDOMIA · CONDOMÍNIO FÁCIL</p><h2>Relatório completo — ${esc(condo.name)}</h2><p>${esc(condo.address||'')} ${esc(condo.postal_code||'')} ${esc(condo.city||'')}</p><p class="cr-muted">Gerado em ${esc(new Date(d.generatedAt).toLocaleString('pt-PT'))} · Histórico completo disponível para o seu perfil. Ocorrências dos condóminos só chegam à gestora após aprovação.</p></header><div class="cr-stats">${stats.map(([k,v])=>`<div><strong>${v}</strong><span>${k}</span></div>`).join('')}</div>
 <section class="cr-section"><h3>Resumo financeiro</h3><div class="cr-stats">${[['Emitido (sem anuladas)',total.charged],['Recebimentos',total.receipts],['Por liquidar',total.outstanding],['Em atraso',total.overdue],['Recebido por alocar',total.unallocated]].map(([k,v])=>`<div><strong>${money(v)}</strong><span>${k}</span></div>`).join('')}</div><p class="cr-muted">Valores de quotas e pagamentos registados. Não inclui despesas nem representa o saldo bancário. Os montantes por liquidar são calculados pelas alocações dos pagamentos.</p></section>
 ${table('Financeiro por fração',['Fração','Emitido','Liquidado','Por liquidar','Em atraso'],total.byFraction.map(x=>[x.fraction.code,money(x.charged),money(x.paid),money(x.outstanding),money(x.overdue)]))}
 ${table('Quotas e cobranças',['Fração','Descrição','Vencimento','Valor','Estado'],d.fraction_charges.map(c=>[fraction(c.fraction_id),c.description,date(c.due_date),money(cents(c.amount_due)),label(c.status)]))}
 ${table('Recebimentos',['Fração','Data','Método','Referência','Valor'],d.fraction_payments.map(p=>[fraction(p.fraction_id),date(p.paid_on),label(p.method),p.reference,money(cents(p.amount))]))}
 ${table('Frações e acessos',['Fração','Piso','Permilagem','Estado','Contas ativas','Administrador'],d.fractions.map(f=>[f.code,f.floor,f.permillage,label(f.status),members.filter(m=>m.fraction_id===f.id).length,members.some(m=>m.fraction_id===f.id&&m.is_condominium_admin)?'Sim':'Não']))}
 ${table('Ocorrências',['Data','Ocorrência / descrição','Local / fração','Prioridade','Estado','Fornecedor'],d.issues.map(i=>[date(i.created_at),[i.title,i.description,i.review_note].filter(Boolean).join('\n'),[i.place,fraction(i.fraction_id)].filter(Boolean).join(' · '),label(i.priority),issueDisplayLabel(i),supplier(i.supplier_id)]))}
 ${table('Assembleias',['Data','Título / local','Estado','Ordem de trabalhos','Ata'],d.assemblies.map(a=>[a.scheduled_for?new Date(a.scheduled_for).toLocaleString('pt-PT'):'—',[a.title,a.location].filter(Boolean).join('\n'),label(a.status),a.agenda,a.minutes]))}
 ${table('Votações',['Votação','Período','Estado','Resultados agregados'],d.polls.map(p=>[`${p.title}\n${p.description||''}`,`${date(p.opens_at)} — ${date(p.closes_at)}`,label(p.status),d.results[p.id]===null?'Resultados ainda não disponíveis':`${p.status==='open'?'Provisórios\n':''}${['yes','no','abstain'].map(choice=>{const r=d.results[p.id]?.find(r=>r.choice===choice);return `${label(choice)}: ${Number(r?.votes||0)} voto(s) · ${Number(r?.permillage||0)} ‰`;}).join('\n')}`]))}
 <p class="cr-muted">Um voto por fração. A permilagem é registada no momento do voto.</p>
 ${table('Manutenções',['Manutenção','Agendada','Concluída','Estado','Fornecedor','Notas'],d.maintenance.map(m=>[m.title,date(m.scheduled_for),date(m.completed_at),label(m.status),supplier(m.supplier_id),m.notes]))}
 ${table('Equipamentos',['Nome','Categoria','Local','Marca / modelo','Próxima manutenção'],d.equipment.map(e=>[e.name,e.category,e.location,[e.brand,e.model].filter(Boolean).join(' '),date(e.next_maintenance_on)]))}
 ${table('Obrigações',['Obrigação','Responsável','Última / próxima data','Ativa','Notas'],d.obligations.map(o=>[o.title,o.owner_name,`${date(o.last_date)} / ${date(o.next_date)}`,o.active?'Sim':'Não',o.notes]))}
 ${table('Listas de verificação',['Obrigação','Verificação','Concluída'],d.obligation_checklist_items.map(i=>[obligation(i.obligation_id),i.label,i.done?'Sim':'Não']))}
 ${table('Inspeções',['Obrigação','Data','Resultado','Notas / evidência'],d.obligation_inspections.map(i=>[obligation(i.obligation_id),date(i.performed_on),label(i.result),[i.notes,i.evidence].filter(Boolean).join('\n')]))}
 ${table('Serviços periódicos',['Serviço','Área','Frequência','Próxima data','Fornecedor','Ativo'],d.periodic_services.map(s=>[s.title,s.area,s.frequency,date(s.next_service_on),supplier(s.supplier_id),s.active?'Sim':'Não']))}
 ${table('Visitas de serviços',['Serviço','Data','Resultado','Notas'],d.periodic_service_visits.map(v=>[d.periodic_services.find(s=>s.id===v.periodic_service_id)?.title,date(v.performed_on),label(v.result),v.notes]))}
 ${table('Fornecedores',['Nome','Categoria','Contacto','Telefone','Email','Estado'],d.suppliers.map(s=>[s.name,s.category,s.contact_name,s.phone,s.email,label(s.status)]))}
 ${table('Documentos',['Nome','Categoria','Data','Validade','Visibilidade'],d.documents.map(d=>[d.name,d.category,date(d.document_date||d.created_at),date(d.expires_at),d.visibility]))}
 ${table('Avisos',['Data','Título','Mensagem','Importante','Requer confirmação'],d.notices.map(n=>[date(n.published_at),n.title,n.body,n.important?'Sim':'Não',n.requires_ack?'Sim':'Não']))}
 <p class="cr-muted">Reservas: módulo ainda não disponível na plataforma.</p></article>`;
}
export function view(s){
 const condos=s.condominiums.filter(c=>!s.dashboardCompanyId||c.company_id===s.dashboardCompanyId);
 const nextScope=`${s.user?.id}:${s.dashboardCompanyId||''}:${condos.map(c=>c.id).sort().join(',')}`;
 if(scope!==nextScope){scope=nextScope;selected='';data=null;loading=false;error='';generation++;}
 const condo=condos.find(c=>c.id===selected);
 return `<section class="panel cr-controls"><h2>Relatórios</h2><p>Selecione um condomínio para consultar o resumo completo de todos os módulos.</p><form id="reportForm" class="cf-form-line"><label for="reportCondominium">Condomínio</label><select id="reportCondominium" class="cf-list-filter" required><option value="">Selecionar condomínio</option>${condos.map(c=>`<option value="${esc(c.id)}" ${selected===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select><button class="primary-btn" type="submit" ${!condo||loading?'disabled':''}>${loading?'A preparar…':'Gerar relatório'}</button>${data?'<button type="button" class="ghost-btn" id="printReport">Imprimir / Guardar PDF</button>':''}</form>${error?`<p role="alert" class="cr-error">${esc(error)}</p>`:''}</section>${data&&condo?reportMarkup(condo,data):`<section class="panel"><p class="cr-muted" role="status">${loading?'A reunir os registos do condomínio…':'Escolha o condomínio e clique em Gerar relatório.'}</p></section>`}`;
}
export const printStyles=`body{font:11px Arial,sans-serif;color:#17243a;margin:24px}h2{font-size:23px}h3{margin-top:24px;font-size:16px;break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{text-align:left;padding:7px;border-bottom:1px solid #dce2e8;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}.cr-stats{display:flex;flex-wrap:wrap;gap:18px;margin:20px 0}.cr-stats strong,.cr-stats span{display:block}.cr-stats strong{font-size:19px}.cr-muted{color:#59677b;line-height:1.5}.cr-brand{color:#087f83;font-weight:bold}small{font-weight:normal}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}.table-wrap{overflow:visible}}`;
export function bind(s,{rerender}){
 document.querySelector('#reportCondominium')?.addEventListener('change',e=>{selected=e.target.value;data=null;error='';loading=false;generation++;rerender();});
 document.querySelector('#reportForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!selected||loading)return;const id=selected,ticket=++generation,owner=s.user?.id;data=null;loading=true;error='';rerender();try{const result=await loadReport(id);if(ticket===generation&&s.user?.id===owner)data=result;}catch(err){if(ticket===generation)error=err.message;}finally{if(ticket===generation){loading=false;rerender();}}});
 document.querySelector('#printReport')?.addEventListener('click',()=>{const condo=s.condominiums.find(c=>c.id===selected);if(!data||!condo)return;const popup=window.open('','_blank');if(!popup){error='Permita a abertura da janela de impressão neste navegador.';rerender();return;}popup.opener=null;popup.document.write(`<!doctype html><html lang="pt"><head><meta charset="UTF-8"><title>${esc(condo.name)} — Relatório Condomia</title><style>${printStyles}</style></head><body>${reportMarkup(condo,data)}</body></html>`);popup.document.close();popup.focus();popup.print();});
}
