import * as api from './api.js';
import {escapeHtml as e, scopedCondos, scopedItems, icon} from './mockup-ui.js';

const states={draft:'Rascunho',scheduled:'Agendada',completed:'Realizada',cancelled:'Cancelada',open:'Aberta',closed:'Encerrada',waiting:'Por iniciar',expired:'Encerrada'};
const choices={yes:'A favor',no:'Contra',abstain:'Abstenção'};
const date=v=>new Date(v).toLocaleString('pt-PT',{dateStyle:'medium',timeStyle:'short'});
const localDate=v=>{const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const pollState=p=>p.status==='open'?(Date.now()>=new Date(p.closes_at)?'expired':Date.now()<new Date(p.opens_at)?'waiting':'open'):p.status;
const manage=(s,id)=>s.profile?.is_super_admin||s.companyMembers.some(m=>m.user_id===s.user.id&&m.status==='active'&&['admin','manager'].includes(m.role)&&m.company_id===s.condominiums.find(c=>c.id===id)?.company_id);
const condoName=(s,id)=>s.condominiums.find(c=>c.id===id)?.name||'Condomínio';
const text=(title,value)=>`<section class="cf-governance-text"><h3>${title}</h3><p>${e(value||'Ainda não disponível.')}</p></section>`;

export function collection(s,kind){
 const assembly=kind==='assemblies', items=scopedItems(s,assembly?'assemblies':'polls');
 const canCreate=scopedCondos(s).some(c=>manage(s,c.id));
 return `<section class="panel"><div class="panel-head"><h2>${assembly?'Assembleias':'Votações'}</h2>${canCreate?`<button class="primary-btn" data-governance-new="${kind}">${icon('plus')}${assembly?'Nova assembleia':'Nova votação'}</button>`:''}</div>
 ${items.length?`<div class="rows">${items.map(i=>`<button class="data-row row-button cf-governance-row" data-governance-kind="${kind}" data-governance-id="${e(i.id)}"><span class="cf-square-icon blue">${icon(assembly?'calendar':'vote')}</span><span><strong>${e(i.title)}</strong><small>${e(condoName(s,i.condominium_id))} · ${e(date(assembly?i.scheduled_for:i.closes_at))}${assembly?'':' · fim da votação'}</small></span><span class="cf-status">${states[assembly?i.status:pollState(i)]}</span>${icon('chevron')}</button>`).join('')}</div>`:`<p class="cf-empty">${assembly?'Ainda não existem assembleias.':'Ainda não existem votações.'}</p>`}</section>`;
}

export function bind(s,{reload,modalShell,closeModal,condominiumId=null}){
 const show=(title,body)=>{
  const host=document.querySelector('#modalHost');host.innerHTML=modalShell(title,'CONDOMÍNIO',body);
  host.querySelector('.modal').classList.add('cf-governance-modal');
  host.querySelector('[data-close]').onclick=closeModal;
  return host;
 };
 const error=(host,err)=>{const el=host.querySelector('[data-governance-error]');if(el)el.textContent=err?.message||'Não foi possível concluir a operação.';};
 const formField=(label,name,value='',type='text',required=true)=>`<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${required?'required':''} ${type==='text'?'maxlength="200"':''}></label>`;
 const edit=(kind,item=null)=>{
  const assembly=kind==='assemblies', condos=(condominiumId?s.condominiums.filter(c=>c.id===condominiumId):scopedCondos(s)).filter(c=>manage(s,c.id));
  if(!condos.length||item&&!manage(s,item.condominium_id))return;
  const initial=item?.condominium_id||condominiumId||s.dashboardCondoId||condos[0].id;
  const locked=item&&!assembly&&item.status!=='draft';
  const options=assembly?['draft','scheduled','completed','cancelled']:locked?[item.status,...(item.status==='open'?['closed','cancelled']:[])]:['draft','open'];
  const host=show(item?'Editar '+(assembly?'assembleia':'votação'):(assembly?'Nova assembleia':'Nova votação'),`<form id="governanceForm" class="form-grid">
   <label class="wide">Condomínio<select name="condominium_id" ${item?'disabled':''}>${condos.map(c=>`<option value="${e(c.id)}" ${c.id===initial?'selected':''}>${e(c.name)}</option>`).join('')}</select></label>
   <fieldset class="wide cf-governance-fields" ${locked?'disabled':''}>
   ${formField(assembly?'Título':'Pergunta da votação','title',item?.title||'')}
   ${assembly?`${formField('Data e hora (hora local)','scheduled_for',localDate(item?.scheduled_for||Date.now()+86400000),'datetime-local')}${formField('Local / ligação da reunião','location',item?.location||'')}<label>Ordem de trabalhos<textarea name="agenda" required maxlength="20000" rows="5">${e(item?.agenda||'')}</textarea></label>`:
   `<label>Enquadramento<textarea name="description" rows="4" maxlength="20000">${e(item?.description||'')}</textarea></label><label>Assembleia associada<select name="assembly_id"></select></label>${formField('Início (hora local)','opens_at',localDate(item?.opens_at||Date.now()),'datetime-local')}${formField('Fim (hora local)','closes_at',localDate(item?.closes_at||Date.now()+86400000),'datetime-local')}<p>Opções: A favor, Contra e Abstenção. Um voto por fração. Após a publicação, a pergunta e as datas ficam fixas.</p>`}
   </fieldset>
   ${assembly?`<label class="wide">Ata<textarea name="minutes" rows="6" maxlength="100000">${e(item?.minutes||'')}</textarea></label>`:''}
   <label class="wide">Estado<select name="status">${options.map(v=>`<option value="${v}" ${v===(item?.status||'draft')?'selected':''}>${states[v]}</option>`).join('')}</select></label>
   <p class="wide">${assembly?'As assembleias agendadas, realizadas e canceladas ficam visíveis aos membros do condomínio.':'Os resultados ficam disponíveis aos condóminos quando a votação termina.'}</p>
   <p class="wide flash error" role="alert" data-governance-error hidden></p><div class="wide form-actions"><button class="primary-btn" type="submit">Guardar</button></div></form>`);
  const form=host.querySelector('form');
  const fillAssemblies=()=>{const select=form.elements.assembly_id;if(!select)return;const id=item?.condominium_id||form.elements.condominium_id.value;select.innerHTML='<option value="">Sem assembleia associada</option>'+s.assemblies.filter(a=>a.condominium_id===id).map(a=>`<option value="${e(a.id)}" ${a.id===item?.assembly_id?'selected':''}>${e(a.title)}</option>`).join('');};
  fillAssemblies();form.elements.condominium_id.onchange=fillAssemblies;
  form.onsubmit=async ev=>{
   ev.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;const values=Object.fromEntries(new FormData(form));
   try{
    const payload=locked?{status:values.status}:{...values,condominium_id:item?.condominium_id||values.condominium_id};
    if(!locked){if(assembly)payload.scheduled_for=new Date(values.scheduled_for).toISOString();else{payload.opens_at=new Date(values.opens_at).toISOString();payload.closes_at=new Date(values.closes_at).toISOString();payload.assembly_id=values.assembly_id||null;if(payload.closes_at<=payload.opens_at)throw new Error('O fim deve ser posterior ao início.');}}
    const table=assembly?'assemblies':'polls';if(item)await api.update(table,item.id,payload);else await api.insert(table,payload);
    closeModal();await reload();
   }catch(err){host.querySelector('[data-governance-error]').hidden=false;error(host,err);button.disabled=false;}
  };
 };
 const detail=async(kind,id)=>{
  const assembly=kind==='assemblies', item=s[assembly?'assemblies':'polls'].find(i=>i.id===id);if(!item)return;
  const canManage=manage(s,item.condominium_id);
  const voted=new Set(s.pollVotes.filter(v=>v.poll_id===id).map(v=>v.fraction_id));
  const eligible=s.fractions.filter(f=>f.condominium_id===item.condominium_id&&f.status==='active'&&!voted.has(f.id)&&s.condominiumMembers.some(m=>m.fraction_id===f.id&&m.condominium_id===item.condominium_id&&m.user_id===s.user.id&&m.status==='active'&&['owner','representative'].includes(m.member_role)));
  const currentVotes=s.pollVotes.filter(v=>v.poll_id===id&&v.voter_id===s.user.id);
  const host=show(item.title,`<div class="cf-governance-detail"><p>${e(condoName(s,item.condominium_id))} · <strong>${states[assembly?item.status:pollState(item)]}</strong></p>
    ${assembly?`${text('Data e local',date(item.scheduled_for)+' · '+item.location)}${text('Ordem de trabalhos',item.agenda)}${text('Ata',item.minutes)}${s.polls.filter(p=>p.assembly_id===id).length?`<h3>Votações da assembleia</h3>${s.polls.filter(p=>p.assembly_id===id).map(p=>`<button class="ghost-btn" data-related-poll="${e(p.id)}">${e(p.title)}</button>`).join('')}`:''}`:
    `${text('Período de votação',date(item.opens_at)+' — '+date(item.closes_at))}${text('Enquadramento',item.description)}${item.assembly_id?`<button class="text-btn" data-related-assembly="${e(item.assembly_id)}">Ver assembleia associada</button>`:''}
    ${currentVotes.length?text('Os seus votos',currentVotes.map(v=>(s.fractions.find(f=>f.id===v.fraction_id)?.code||'Fração')+': '+choices[v.choice]).join('\n')):''}
    ${pollState(item)==='open'&&eligible.length?`<form id="ballotForm" class="form-grid"><label class="wide">Fração<select name="fraction_id">${eligible.map(f=>`<option value="${e(f.id)}">${e(f.code)}</option>`).join('')}</select></label><fieldset class="wide cf-vote-options"><legend>O seu voto</legend>${Object.entries(choices).map(([v,label])=>`<label><input type="radio" name="choice" value="${v}" required>${label}</label>`).join('')}</fieldset><label class="wide cf-vote-confirm"><input type="checkbox" required> Confirmo o voto. Depois de registado não poderá ser alterado.</label><button class="primary-btn wide" type="submit">Registar voto</button></form>`:pollState(item)==='open'?'<p>Não tem frações elegíveis por votar nesta votação.</p>':''}
    <section data-results aria-live="polite">A carregar resultados…</section>`}
    <p role="alert" data-governance-error></p>${canManage?'<button class="ghost-btn" data-edit-governance>Editar / alterar estado</button>':''}</div>`);
  host.querySelector('[data-edit-governance]')?.addEventListener('click',()=>edit(kind,item));
  host.querySelectorAll('[data-related-poll]').forEach(b=>b.onclick=()=>detail('votes',b.dataset.relatedPoll));
  host.querySelector('[data-related-assembly]')?.addEventListener('click',()=>detail('assemblies',item.assembly_id));
  host.querySelector('#ballotForm')?.addEventListener('submit',async ev=>{
   ev.preventDefault();const form=ev.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;
   try{const v=Object.fromEntries(new FormData(form));await api.insert('poll_votes',{poll_id:id,condominium_id:item.condominium_id,fraction_id:v.fraction_id,choice:v.choice});closeModal();await reload();await detail(kind,id);}
   catch(err){error(host,err?.cause?.code==='23505'?new Error('Esta fração já tem um voto registado.'):err);button.disabled=false;}
  });
  if(!assembly){try{const rows=await api.pollResults(id);const results=host.querySelector('[data-results]');if(!results)return;results.innerHTML=rows===null?'<p>Os resultados estarão disponíveis após o encerramento.</p>':`<h3>Resultados ${canManage&&pollState(item)==='open'?'provisórios':''}</h3><div class="table-wrap"><table><thead><tr><th>Opção</th><th>Votos</th><th>Permilagem</th></tr></thead><tbody>${Object.entries(choices).map(([v,label])=>{const row=rows.find(r=>r.choice===v);return `<tr><td>${label}</td><td>${Number(row?.votes||0)}</td><td>${Number(row?.permillage||0).toLocaleString('pt-PT')} ‰</td></tr>`;}).join('')}</tbody></table></div><p>Um voto por fração. Permilagem registada no momento do voto.</p>`;}catch(err){const results=host.querySelector('[data-results]');if(results)results.textContent='Não foi possível carregar os resultados.';error(host,err);}}
 };
 document.querySelectorAll('[data-governance-new]').forEach(b=>b.onclick=()=>edit(b.dataset.governanceNew));
 document.querySelectorAll('[data-governance-id]').forEach(b=>b.onclick=()=>detail(b.dataset.governanceKind,b.dataset.governanceId));
 document.querySelectorAll('[data-assembly]').forEach(b=>b.onclick=()=>detail('assemblies',b.dataset.assembly));
}
