export const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function bankAmount(v){
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Valor inválido');return Math.round(v*100)/100;}
 let s=String(v??'').trim().replace(/[€\s]/g,'');if(!s)return 0;
 if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);
 if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
 if(!/^[+-]?\d+(\.\d{1,2})?$/.test(s))throw Error('Valor inválido: '+v);
 const n=Number(s);if(!Number.isFinite(n))throw Error('Valor inválido');return Math.round(n*100)/100;
}
export function bankDate(v){
 if(v instanceof Date&&!isNaN(v))return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
 if(typeof v==='number'){return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);}
 const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m){const t=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);if(t)m=[s,t[3],t[2].padStart(2,'0'),t[1].padStart(2,'0')];}
 if(!m)throw Error('Data inválida: '+s);const iso=`${m[1]}-${m[2]}-${m[3]}`;
 if(new Date(iso+'T12:00:00Z').toISOString().slice(0,10)!==iso)throw Error('Data inválida: '+s);return iso;
}
export function parseBankRows(rows,mapping,condo,account){
 if(!account.trim())throw Error('Identifique a conta bancária.');const seen=new Map();
 return rows.filter(r=>r.some(v=>String(v??'').trim())).map((r,i)=>{try{
 const get=k=>mapping[k]===''||mapping[k]==null?'':r[Number(mapping[k])];
 const amount=mapping.amount!==''?bankAmount(get('amount')):Math.abs(bankAmount(get('credit')))-Math.abs(bankAmount(get('debit')));
 if(!amount)throw Error('Movimento sem valor');const booked_on=bankDate(get('date'));const description=String(get('description')).trim(),sender=String(get('sender')).trim(),reference=String(get('reference')).trim();
 const key=JSON.stringify([booked_on,amount,normalize(description),normalize(sender),normalize(reference)]);const occurrence=(seen.get(key)||0)+1;seen.set(key,occurrence);
 return {condominium_id:condo,account:account.trim().toLowerCase(),booked_on,amount,description,sender,reference,occurrence,fingerprint:''};
 }catch(e){throw Error(`Linha ${i+2}: ${e.message}`);}});
}
export function suggestMovement(m,fractions,payments,expenses,movements=[]){
 const usedPayments=new Set(movements.filter(x=>x.status==='reconciled').map(x=>x.payment_id));
 if(m.amount<0){const found=expenses.filter(e=>e.status!=='cancelled'&&Number(e.amount)===Math.abs(Number(m.amount))&&e.invoice_ref&&normalize(m.description+' '+m.reference).includes(normalize(e.invoice_ref))&&!movements.some(x=>x.expense_id===e.id&&x.status==='reconciled'));return found.length===1?{value:'e:'+found[0].id,reason:'Referência da fatura e valor'}:{value:'',reason:'Selecione a despesa'};}
 const text=normalize(`${m.description} ${m.reference} ${m.sender}`);
 const matched=fractions.filter(f=>{const code=normalize(f.code).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(?:fracao|frac|fr|apartamento)\\s*[.:#-]?\\s*${code}(?![a-z0-9])`).test(text);});
 const possible=payments.filter(p=>Number(p.amount)===Number(m.amount)&&Math.abs(new Date(p.paid_on)-new Date(m.booked_on))<=3*86400000&&!usedPayments.has(p.id));
 const exact=possible.filter(p=>(m.reference&&normalize(m.reference)===normalize(p.reference))||(matched.length===1&&p.fraction_id===matched[0].id));
 if(exact.length===1)return {value:'p:'+exact[0].id,reason:'Pagamento já registado — não será duplicado'};
 if(possible.length)return {value:'',reason:'Possível pagamento existente: reveja antes de criar'};
 if(matched.length===1)return {value:'f:'+matched[0].id,reason:'Código da fração na descrição'};
 const habitual=movements.filter(x=>x.status==='reconciled'&&x.fraction_id&&m.sender&&normalize(x.sender)===normalize(m.sender));const ids=[...new Set(habitual.map(x=>x.fraction_id))];
 return ids.length===1?{value:'f:'+ids[0],reason:'Remetente já associado a esta fração'}:{value:'',reason:matched.length>1?'Referência ambígua':'Sem correspondência segura'};
}
