const cents=v=>Math.round(Number(v||0)*100);
const sum=rows=>rows.reduce((n,r)=>n+cents(r.amount),0);
export function debtAgeing(data,today){
 const paid=new Map();for(const a of data.payment_allocations||[])paid.set(a.charge_id,(paid.get(a.charge_id)||0)+cents(a.amount));
 return (data.fraction_charges||[]).filter(c=>c.status!=='cancelled').map(c=>{
  const balance=Math.max(0,cents(c.amount_due)-(paid.get(c.id)||0));
  const days=c.due_date?Math.max(0,Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(c.due_date+'T00:00:00Z'))/86400000)):0;
  return {...c,balance,days,bucket:!c.due_date?'Sem vencimento':days===0?'Não vencida':days<=30?'1–30 dias':days<=60?'31–60 dias':days<=90?'61–90 dias':'Mais de 90 dias'};
 }).filter(c=>c.balance>0).sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
}
export function budgetComparison(data,year){
 const budgets=(data.condominium_budgets||[]).filter(b=>Number(b.year)===Number(year));
 const expenses=(data.condominium_expenses||[]).filter(e=>e.status!=='cancelled'&&e.due_on?.slice(0,4)===String(year));
 return [...new Set([...budgets,...expenses].map(x=>x.category||'other'))].sort().map(category=>{
  const planned=budgets.filter(b=>(b.category||'other')===category),actual=expenses.filter(e=>(e.category||'other')===category);
  return {category,configured:planned.length>0,budget:sum(planned),recorded:sum(actual),paid:sum(actual.filter(e=>e.status==='paid')),pending:sum(actual.filter(e=>e.status!=='paid')),remaining:sum(planned)-sum(actual)};
 });
}
export const categoryLabel=k=>({cleaning:'Limpeza',maintenance:'Manutenção',insurance:'Seguros',electricity:'Eletricidade',water:'Água',elevator:'Elevadores',gardening:'Jardinagem',management:'Gestão',other:'Outros'})[k]||k;
// Text cells are neutralized to prevent spreadsheet formula execution.
export function csvCell(value){let s=typeof value==='number'?String(value).replace('.',','):String(value??'');if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function financialCsv(condo,data,today){
 const euro=n=>n/100;
 const rows=[['Condomia — Resumo financeiro'],['Condomínio',condo.name],['Gerado em',data.generatedAt],['Valores em EUR; saldos atuais pelas alocações dos pagamentos'],[],['Dívidas por fração'],['Fração','Período da quota','Descrição','Vencimento','Saldo em dívida','Dias de atraso','Antiguidade']];
 for(const c of debtAgeing(data,today))rows.push([data.fractions.find(f=>f.id===c.fraction_id)?.code||'—',c.period_year?`${c.period_month?String(c.period_month).padStart(2,'0')+'/':''}${c.period_year}`:'',c.description,c.due_date,euro(c.balance),c.days,c.bucket]);
 rows.push([],['Orçamento e despesas por ano de vencimento',today.slice(0,4)],['Categoria','Orçamento','Despesas registadas','Pagas','Por pagar','Orçamento disponível']);
 for(const b of budgetComparison(data,today.slice(0,4)))rows.push([categoryLabel(b.category),b.configured?euro(b.budget):'Não definido',euro(b.recorded),euro(b.paid),euro(b.pending),b.configured?euro(b.remaining):'Não definido']);
 rows.push([],['Recebimentos'],['Fração','Data','Método','Referência','Valor']);
 for(const p of data.fraction_payments||[])rows.push([data.fractions.find(f=>f.id===p.fraction_id)?.code||'—',p.paid_on,p.method,p.reference,euro(cents(p.amount))]);
 return '\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
