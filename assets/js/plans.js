// Public catalogue; amounts are monthly totals in EUR, VAT included.
export const PLANS=Object.freeze([
 {id:'condomia_1',name:'Condomia 1',limit:1,price:11.90},
 {id:'condomia_10',name:'Condomia 10',limit:10,price:80},
 {id:'condomia_50',name:'Condomia 50',limit:50,price:380},
 {id:'condomia_100',name:'Condomia 100',limit:100,price:650},
 {id:'condomia_200',name:'Condomia 200',limit:200,price:1200}
]);
export const euros=n=>Number(n).toLocaleString('pt-PT',{style:'currency',currency:'EUR'});
export function planFields(selected='') {return `<label class="wide">Plano / limite de condomínios<select name="plan_id" required><option value="">Selecionar plano</option>${PLANS.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${p.name} · até ${p.limit} · ${euros(p.price)}/mês</option>`).join('')}</select></label><p class="wide" data-plan-price>IVA incluído. A capacidade é partilhada por toda a empresa.</p>`;}
export function bindPlanFields(root){const update=()=>{const p=PLANS.find(p=>p.id===root.querySelector('[name=plan_id]')?.value);const annual=root.querySelector('[name=cycle]')?.value==='annual';const text=root.querySelector('[data-plan-price]');if(text&&p)text.textContent=`Até ${p.limit} condomínios · ${euros(p.price)}/mês · ${euros(p.price/p.limit)} por condomínio à capacidade máxima. IVA incluído.${annual?` Total de 12 meses: ${euros(p.price*12)} (sem desconto anual).`:''}`;};root.querySelectorAll('[name=plan_id],[name=cycle]').forEach(el=>el.addEventListener('change',update));update();}
export function planSummary(license){const p=PLANS.find(p=>p.id===license?.plan_id);return p?`${p.name} · até ${license.condominium_limit||p.limit} · ${euros(license.monthly_price||p.price)}/mês · IVA incluído`:'Licença anterior · plano por definir';}
export async function enrichLicensePlans(client,licenses){const {data,error}=await client.from('company_admin_licenses').select('id,plan_id,condominium_limit,monthly_price,vat_included');if(error)throw error;return (licenses||[]).map(l=>({...l,...data?.find(p=>p.id===l.id)}));}
