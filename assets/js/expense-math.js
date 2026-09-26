export const cents=v=>Math.round(Number(v||0)*100);
export function cashSummary(payments,expenses,setting,start,end){
 const sum=(rows,key)=>rows.reduce((n,r)=>n+cents(r[key]),0);
 const active=expenses.filter(e=>e.status!=='cancelled');
 const openingOn=setting?.opening_on||'0001-01-01';
 const effectiveStart=start>openingOn?start:openingOn;
 const receipts=payments.filter(p=>p.paid_on>=effectiveStart&&p.paid_on<=end);
 const paid=active.filter(e=>e.status==='paid'&&e.paid_on>=effectiveStart&&e.paid_on<=end);
 const carried=(setting?cents(setting.opening_amount):0)+sum(payments.filter(p=>p.paid_on>=openingOn&&p.paid_on<start),'amount')-sum(active.filter(e=>e.status==='paid'&&e.paid_on>=openingOn&&e.paid_on<start),'amount');
 return {configured:!!setting,valid:openingOn<=end,opening:carried,received:sum(receipts,'amount'),spent:sum(paid,'amount'),closing:carried+sum(receipts,'amount')-sum(paid,'amount'),payable:sum(active.filter(e=>e.due_on<=end&&(!e.paid_on||e.paid_on>end)),'amount'),expenses:active.filter(e=>e.due_on>=start&&e.due_on<=end),effectiveStart};
}
