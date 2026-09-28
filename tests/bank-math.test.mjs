import assert from 'node:assert/strict';
import {bankAmount,bankDate,parseBankRows,suggestMovement} from '../assets/js/bank-math.js';
assert.equal(bankAmount('1.234,56 €'),1234.56);assert.equal(bankAmount('(80,00)'),-80);assert.throws(()=>bankAmount('abc'));assert.equal(bankDate('26/09/2026'),'2026-09-26');assert.throws(()=>bankDate('31/02/2026'));
const mapping={date:'0',description:'1',amount:'2',credit:'',debit:'',sender:'',reference:''};
const rows=parseBankRows([['26/09/2026','Fração A','75,00'],['26/09/2026','Fração A','75,00']],mapping,'c','Main');assert.equal(rows[1].occurrence,2);
const fractions=[{id:'a',code:'A'},{id:'aa',code:'AA'}];assert.equal(suggestMovement(rows[0],fractions,[],[]).value,'f:a');assert.equal(suggestMovement({...rows[0],description:'Transferência'},fractions,[],[]).value,'');assert.equal(suggestMovement(rows[0],fractions,[{id:'pay',fraction_id:'a',amount:75,paid_on:'2026-09-26'}],[]).value,'p:pay');
assert.equal(suggestMovement({...rows[0],description:'Fração AA'},fractions,[],[]).value,'f:aa');
console.log('PASS: PT amounts, dates, occurrence identity, no amount-only matching, existing payment and fraction boundaries');

const duplicate=[{id:'p1',fraction_id:'a',amount:75,paid_on:'2026-09-26'},{id:'p2',fraction_id:'a',amount:75,paid_on:'2026-09-26'}];
assert.equal(suggestMovement(rows[0],fractions,duplicate,[]).confidence,'ambiguous');
assert.equal(suggestMovement({...rows[0],reference:'R1'},fractions,[{id:'p3',fraction_id:'aa',reference:'R1',amount:75,paid_on:'2026-09-26'}],[]).confidence,'ambiguous');
assert.equal(suggestMovement({...rows[0],description:'Transferência',sender:'Maria'},[{id:'a',code:'A',status:'inactive'}],[],[],[{status:'reconciled',fraction_id:'a',sender:'Maria'}]).value,'');
