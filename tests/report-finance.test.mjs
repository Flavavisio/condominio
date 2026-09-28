import assert from 'node:assert/strict';
import {debtAgeing,budgetComparison,financialCsv,csvCell} from '../assets/js/report-finance.js';
const today='2026-09-29';
const d={generatedAt:today,fractions:[{id:'f',code:'A'}],fraction_charges:[
 {id:'a',fraction_id:'f',amount_due:100.10,due_date:'2026-08-30',period_year:2026,period_month:8},
 {id:'b',fraction_id:'f',amount_due:50,due_date:'2026-08-29'},
 {id:'future',fraction_id:'f',amount_due:20,due_date:'2026-10-01'},
 {id:'settled',fraction_id:'f',amount_due:10,due_date:'2026-01-01'},
 {id:'cancelled',amount_due:1000,status:'cancelled',due_date:'2026-01-01'}],payment_allocations:[{charge_id:'a',amount:40.05},{charge_id:'settled',amount:10}],fraction_payments:[],condominium_budgets:[{year:2026,category:'cleaning',amount:100}],condominium_expenses:[{category:'cleaning',due_on:'2026-01-01',amount:75.25,status:'paid'},{category:'cleaning',due_on:'2026-10-01',amount:50,status:'pending'},{category:'water',due_on:'2026-01-01',amount:15,status:'pending'},{category:'cleaning',due_on:'2025-01-01',amount:1000,status:'paid'},{category:'cleaning',due_on:'2026-01-01',amount:1000,status:'cancelled'}]};
const age=debtAgeing(d,today);assert.equal(age.length,3);assert.equal(age.find(c=>c.id==='a').balance,6005);assert.equal(age.find(c=>c.id==='a').bucket,'1–30 dias');assert.equal(age.find(c=>c.id==='b').bucket,'31–60 dias');assert.equal(age.find(c=>c.id==='future').bucket,'Não vencida');
const budget=budgetComparison(d,2026);assert.deepEqual(budget.find(b=>b.category==='cleaning'),{category:'cleaning',configured:true,budget:10000,recorded:12525,paid:7525,pending:5000,remaining:-2525});assert.equal(budget.find(b=>b.category==='water').configured,false);
assert.equal(csvCell('=HYPERLINK("evil")'),'"\'=HYPERLINK(""evil"")"');assert.equal(csvCell(-25.25),'"-25,25"');assert.equal(csvCell('  +SUM(1;2)'),'"\'  +SUM(1;2)"');
const csv=financialCsv({name:'Test; condomínio'},d,today);assert(csv.startsWith('\ufeff'));assert(csv.includes('"60,05"'));assert(csv.includes('"08/2026"'));assert(csv.includes('"Test; condomínio"'));assert(csv.includes('"-25,25"'));
console.log('PASS debt ageing boundaries, partial and settled balances, annual budgets, unbudgeted costs, CSV cents and formula neutralization');
