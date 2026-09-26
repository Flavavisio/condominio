import {PLANS,euros,quotePlan,bestPlan} from './plans.js';
const params=new URLSearchParams(location.search);
// Preserve old notification links and Auth callbacks after separating the public page.
if(params.has('condo')||params.has('code')||/access_token=|refresh_token=|error_description=/.test(location.hash))location.replace(`app.html${location.search}${location.hash}`);
const cards=document.querySelector('#planCards');
cards.innerHTML=PLANS.map(p=>`<article data-plan="${p.id}"><p class="lp-plan-name">${p.name}</p><h3>Até <strong>${p.limit}</strong><span>${p.limit===1?'condomínio':'condomínios'}</span></h3><p class="lp-price">${euros(p.price)}<small>/mês</small></p><p class="lp-unit">${euros(p.price/p.limit)} / condomínio</p><p class="lp-tax">IVA incluído</p><a class="lp-button" href="app.html?plan=${p.id}">Escolher plano →</a><ul><li>Gestão e equipa</li><li>Portal dos condóminos</li><li>Financeiro e comprovativos</li><li>Assembleias e votações</li><li>Relatórios por condomínio</li></ul></article>`).join('');
const input=document.querySelector('#condoCount'),output=document.querySelector('#planRecommendation');
function recommend(){const plan=bestPlan(Number(input.value));document.querySelectorAll('[data-plan]').forEach(c=>c.classList.toggle('selected',c.dataset.plan===plan?.id));output.textContent=plan?`${plan.name}${plan.extraPacks?` + ${plan.extraPacks} pack(s) de 10`:''} · até ${plan.limit} condomínios · ${euros(plan.price)}/mês, IVA incluído`:'Indique um número inteiro entre 1 e 10 200.';}
input.addEventListener('input',recommend);recommend();
const base=document.querySelector('#packBase'),packs=document.querySelector('#extraPacks'),total=document.querySelector('#packTotal'),choose=document.querySelector('#choosePacks');
base.innerHTML=PLANS.filter(p=>p.limit>=10).map(p=>`<option value="${p.id}">${p.name} · ${euros(p.price)}/mês</option>`).join('');
function configure(){const q=quotePlan(base.value,packs.value);choose.hidden=!q;total.textContent=q?`Até ${q.limit} condomínios · ${euros(q.price)}/mês, IVA incluído`:'Indique uma quantidade inteira de packs entre 0 e 1000.';if(q)choose.href=`app.html?plan=${q.id}&extra_packs=${q.extraPacks}`;}
base.addEventListener('change',configure);packs.addEventListener('input',configure);configure();
