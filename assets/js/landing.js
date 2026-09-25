import {PLANS,euros} from './plans.js';
const params=new URLSearchParams(location.search);
// Preserve old notification links and Auth callbacks after separating the public page.
if(params.has('condo')||params.has('code')||/access_token=|refresh_token=|error_description=/.test(location.hash))location.replace(`app.html${location.search}${location.hash}`);
const cards=document.querySelector('#planCards');
cards.innerHTML=PLANS.map(p=>`<article data-plan="${p.id}"><p class="lp-plan-name">${p.name}</p><h3>Até <strong>${p.limit}</strong><span>${p.limit===1?'condomínio':'condomínios'}</span></h3><p class="lp-price">${euros(p.price)}<small>/mês</small></p><p class="lp-unit">${euros(p.price/p.limit)} / condomínio</p><p class="lp-tax">IVA incluído</p><a class="lp-button" href="app.html?plan=${p.id}">Escolher plano →</a><ul><li>Gestão e equipa</li><li>Portal dos condóminos</li><li>Financeiro e comprovativos</li><li>Assembleias e votações</li><li>Relatórios por condomínio</li></ul></article>`).join('');
const input=document.querySelector('#condoCount'),output=document.querySelector('#planRecommendation');
function recommend(){const value=Number(input.value);const plan=Number.isInteger(value)&&value>0?PLANS.find(p=>p.limit>=value):null;document.querySelectorAll('[data-plan]').forEach(c=>c.classList.toggle('selected',c.dataset.plan===plan?.id));output.textContent=plan?`${plan.name} · ${euros(plan.price)}/mês, IVA incluído`:(value>200?'Para mais de 200 condomínios, o plano será definido com a equipa Condomia.':'Indique um número inteiro de condomínios.');}
input.addEventListener('input',recommend);recommend();
