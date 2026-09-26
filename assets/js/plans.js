// Public catalogue; amounts are monthly totals in EUR, VAT included.
export const PLANS=Object.freeze([
 {id:'condomia_1',name:'Condomia 1',limit:1,price:11.90},
 {id:'condomia_10',name:'Condomia 10',limit:10,price:80},
 {id:'condomia_50',name:'Condomia 50',limit:50,price:380},
 {id:'condomia_100',name:'Condomia 100',limit:100,price:650},
 {id:'condomia_200',name:'Condomia 200',limit:200,price:1200}
]);
export const euros=n=>Number(n).toLocaleString('pt-PT',{style:'currency',currency:'EUR'});
export const EXTRA_PACK={size:10,price:80,max:1000};
export function quotePlan(id,count=0){
 const p=PLANS.find(p=>p.id===id);count=Number(count);
 if(!p||!Number.isInteger(count)||count<0||count>EXTRA_PACK.max||(p.limit===1&&count>0))return null;
 return {...p,extraPacks:count,limit:p.limit+count*10,price:p.price+count*80};
}
export function bestPlan(required){
 if(!Number.isInteger(required)||required<1||required>10200)return null;
 return PLANS.map(p=>quotePlan(p.id,p.limit===1?(required>1?1:0):Math.max(0,Math.ceil((required-p.limit)/10))))
 .filter(p=>p&&p.limit>=required).sort((a,b)=>a.price-b.price||a.limit-b.limit)[0]||null;
}
export function planFields(selected='',extra=0) {return `<label class="wide">Plano / limite de condomínios<select name="plan_id" required><option value="">Selecionar plano</option>${PLANS.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${p.name} · até ${p.limit} · ${euros(p.price)}/mês</option>`).join('')}</select></label><label class="wide">Packs adicionais de +10 · 80 €/mês cada<input name="extra_packs" type="number" min="0" max="1000" step="1" required value="${Number.isInteger(Number(extra))?Number(extra):0}"></label><p class="wide" data-plan-price>IVA incluído. Extras disponíveis a partir do plano de 10.</p>`;}
export function bindPlanFields(root){const update=()=>{
 const id=root.querySelector('[name=plan_id]')?.value,extra=root.querySelector('[name=extra_packs]');
 if(extra){extra.disabled=!id||id==='condomia_1';if(extra.disabled)extra.value='0';}
 const p=quotePlan(id,extra?.value||0),annual=root.querySelector('[name=cycle]')?.value==='annual',text=root.querySelector('[data-plan-price]');
 if(text)text.textContent=p?`${p.name}${p.extraPacks?` + ${p.extraPacks} pack(s) de 10`:''} · Até ${p.limit} condomínios · ${euros(p.price)}/mês. IVA incluído.${annual?` Total de 12 meses: ${euros(p.price*12)} (sem desconto anual).`:''}`:'Selecione um plano e uma quantidade inteira de packs válida.';
 };root.querySelectorAll('[name=plan_id],[name=cycle],[name=extra_packs]').forEach(el=>{el.addEventListener('change',update);el.addEventListener('input',update);});update();}
export function planSummary(license){const p=quotePlan(license?.plan_id,license?.extra_packs||0);return p?`${p.name}${p.extraPacks?` + ${p.extraPacks} pack(s) de 10`:''} · até ${license.condominium_limit||p.limit} · ${euros(license.monthly_price||p.price)}/mês · IVA incluído`:'Licença anterior · plano por definir';}
export async function enrichLicensePlans(client,licenses){const {data,error}=await client.from('company_admin_licenses').select('id,plan_id,extra_packs,condominium_limit,monthly_price,vat_included');if(error)throw error;return (licenses||[]).map(l=>({...l,...data?.find(p=>p.id===l.id)}));}
