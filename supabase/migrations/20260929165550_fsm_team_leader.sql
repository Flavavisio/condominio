alter table public.fsm_teams add column leader_id uuid references auth.users(id) on delete set null;
create index fsm_teams_leader on public.fsm_teams(leader_id);
-- Existing teams require an explicit leader selection; do not guess responsibility.
create or replace function private.fsm_api(p_company uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare uid uuid:=auth.uid(); sa boolean; admin boolean; member_role text; enabled boolean; ident uuid; condo uuid; team uuid; job public.fsm_jobs; items jsonb; entry jsonb; checklist_id text; result jsonb; offset_n integer:=greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));
begin
 if uid is null then raise exception 'Sessão necessária' using errcode='42501';end if;
 sa:=private.is_super_admin();
 select role into member_role from public.company_members where company_id=p_company and user_id=uid and status='active';
 admin:=sa or member_role='admin';
 if p_action='price' then
  if not sa then raise exception 'Apenas Super Admin' using errcode='42501';end if;
  update public.module_catalog set monthly_price=(p_data->>'price')::numeric,updated_at=now() where id='fsm';return '{"ok":true}';
 end if;
 if not sa and member_role is null then raise exception 'Sem acesso à empresa' using errcode='42501';end if;
 if not exists(select 1 from public.companies where id=p_company and status='active') then raise exception 'Empresa inativa';end if;
 select coalesce(m.enabled,false) into enabled from public.company_modules m where company_id=p_company and module_id='fsm';
 if p_action='activate' then
  if not admin then raise exception 'Apenas administrador' using errcode='42501';end if;
  if not sa and (p_data->>'enabled')::boolean and (p_data->>'price')::numeric is distinct from (select monthly_price from public.module_catalog where id='fsm') then raise exception 'O preço mudou. Atualize antes de ativar.';end if;
  insert into public.company_modules(company_id,module_id,enabled,updated_by) values(p_company,'fsm',(p_data->>'enabled')::boolean,uid) on conflict(company_id,module_id) do update set enabled=excluded.enabled,updated_at=now(),updated_by=uid;return '{"ok":true}';
 end if;
 if not sa and not exists(select 1 from public.company_admin_licenses where company_id=p_company and status='active' and starts_on<=current_date and expires_on>=current_date) then raise exception 'Licença da empresa inativa';end if;
 if p_action='read' and not coalesce(enabled,false) then
  return jsonb_build_object('enabled',false,'admin',coalesce(admin,false),'price',(select monthly_price from public.module_catalog where id='fsm'),'teams','[]'::jsonb,'people','[]'::jsonb,'condos','[]'::jsonb,'checklists','[]'::jsonb,'jobs','[]'::jsonb,'total',0,'sources','[]'::jsonb);
 end if;
 if p_action='read' then
  return jsonb_build_object('enabled',coalesce(enabled,false),'admin',coalesce(admin,false),'price',(select monthly_price from public.module_catalog where id='fsm'),
  'teams',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('members',(select coalesce(jsonb_agg(user_id),'[]') from public.fsm_team_members where team_id=t.id))) from public.fsm_teams t where t.company_id=p_company and (admin or exists(select 1 from public.fsm_team_members where team_id=t.id and user_id=uid))),'[]'),
  'people',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',cm.user_id,'name',coalesce(p.full_name,u.email),'email',u.email)) from public.company_members cm join auth.users u on u.id=cm.user_id left join public.profiles p on p.user_id=cm.user_id where cm.company_id=p_company and cm.status='active'),'[]') else '[]'::jsonb end,
  'condos',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'address',c.address)) from public.condominiums c where c.company_id=p_company and (admin or exists(select 1 from public.fsm_jobs j join public.fsm_team_members tm on tm.team_id=j.team_id where j.condominium_id=c.id and tm.user_id=uid))),'[]'),
  'checklists',case when admin then coalesce((select jsonb_agg(to_jsonb(c)) from public.fsm_checklists c where company_id=p_company),'[]') else '[]'::jsonb end,
  'jobs',coalesce((select jsonb_agg(to_jsonb(x)) from (select j.*,coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'at',e.created_at,'user',e.user_id) order by e.created_at) from public.fsm_events e where e.job_id=j.id),'[]') events from public.fsm_jobs j where j.company_id=p_company and (admin or exists(select 1 from public.fsm_team_members where team_id=j.team_id and user_id=uid)) order by j.scheduled_for desc,j.id limit 50 offset offset_n) x),'[]'),
  'total',(select count(*) from public.fsm_jobs j where j.company_id=p_company and (admin or exists(select 1 from public.fsm_team_members where team_id=j.team_id and user_id=uid))),
  'sources',case when admin then coalesce((select jsonb_agg(x) from (select id,condominium_id,title,'maintenance' as kind from public.maintenance where condominium_id in(select id from public.condominiums where company_id=p_company) and status='scheduled' union all select id,condominium_id,title,'periodic' from public.periodic_services where condominium_id in(select id from public.condominiums where company_id=p_company) and active) x),'[]') else '[]'::jsonb end);
 end if;
 if not coalesce(enabled,false) then raise exception 'Ative o módulo FSM.';end if;
 if p_action in('team','checklist','job','cancel') and not admin then raise exception 'Apenas administrador' using errcode='42501';end if;
 ident:=nullif(p_data->>'id','')::uuid;
 if p_action='team' then
  if not exists(select 1 from public.company_members where company_id=p_company and user_id=nullif(p_data->>'leader_id','')::uuid and status='active') then raise exception 'Selecione um responsável ativo desta empresa';end if;
  if ident is null then insert into public.fsm_teams(company_id,name,specialty) values(p_company,p_data->>'name',p_data->>'specialty') returning id into ident;
  else update public.fsm_teams set name=p_data->>'name',specialty=p_data->>'specialty',active=coalesce((p_data->>'active')::boolean,true) where id=ident and company_id=p_company;if not found then raise exception 'Equipa inválida';end if;end if;
  if jsonb_typeof(p_data->'members') is distinct from 'array' then raise exception 'Selecione os membros';end if;
  delete from public.fsm_team_members where team_id=ident;
  for checklist_id in select jsonb_array_elements_text(p_data->'members') loop
   if not exists(select 1 from public.company_members where company_id=p_company and user_id=checklist_id::uuid and status='active') then raise exception 'Membro de outra empresa';end if;
   insert into public.fsm_team_members values(ident,checklist_id::uuid) on conflict do nothing;
  end loop;
  insert into public.fsm_team_members(team_id,user_id) values(ident,(p_data->>'leader_id')::uuid) on conflict do nothing;
  update public.fsm_teams set leader_id=(p_data->>'leader_id')::uuid where id=ident;
 elsif p_action='checklist' then
  condo:=(p_data->>'condominium_id')::uuid;
  if not exists(select 1 from public.condominiums where id=condo and company_id=p_company) then raise exception 'Condomínio inválido';end if;
  items:=p_data->'items';if jsonb_typeof(items) is distinct from 'array' then raise exception 'Checklist inválida';end if;
  for entry in select value from jsonb_array_elements(items) loop if jsonb_typeof(entry) is distinct from 'string' or length(trim(entry#>>'{}')) not between 1 and 300 then raise exception 'Afazer inválido';end if;end loop;
  if ident is null then insert into public.fsm_checklists(company_id,condominium_id,name,items) values(p_company,condo,p_data->>'name',items);
  else update public.fsm_checklists set name=p_data->>'name',items=items,active=coalesce((p_data->>'active')::boolean,true) where id=ident and company_id=p_company and condominium_id=condo;if not found then raise exception 'Checklist inválida';end if;end if;
 elsif p_action='job' then
  condo:=(p_data->>'condominium_id')::uuid;team:=(p_data->>'team_id')::uuid;
  if not exists(select 1 from public.condominiums where id=condo and company_id=p_company and status='active') or not exists(select 1 from public.fsm_teams where id=team and company_id=p_company and active) then raise exception 'Condomínio ou equipa inválidos';end if;
  items:='[]';
  for checklist_id in select jsonb_array_elements_text(p_data->'checklists') loop
   select jsonb_agg(jsonb_build_object('task',value#>>'{}','checklist',c.name)) into result from public.fsm_checklists c cross join lateral jsonb_array_elements(c.items) where c.id=checklist_id::uuid and c.condominium_id=condo and c.company_id=p_company and c.active;
   if result is null then raise exception 'Checklist de outro condomínio ou inativa';end if;items:=items||result;
  end loop;
  if jsonb_array_length(items)>300 then raise exception 'Máximo de 300 afazeres por serviço';end if;
  if p_data->>'source_type'='maintenance' and not exists(select 1 from public.maintenance where id=(p_data->>'source_id')::uuid and condominium_id=condo and status='scheduled') then raise exception 'Manutenção inválida';end if;
  if p_data->>'source_type'='periodic' and not exists(select 1 from public.periodic_services where id=(p_data->>'source_id')::uuid and condominium_id=condo and active) then raise exception 'Serviço periódico inválido';end if;
  if ident is not null then raise exception 'Crie nova ordem; cancele a anterior se necessário';end if;
  insert into public.fsm_jobs(company_id,condominium_id,team_id,title,scheduled_for,source_type,source_id,checklist,created_by) values(p_company,condo,team,p_data->>'title',(p_data->>'scheduled_for')::timestamptz,coalesce(p_data->>'source_type','service'),nullif(p_data->>'source_id','')::uuid,items,uid) returning id into ident;
  insert into public.fsm_events(job_id,user_id,action) values(ident,uid,'created');
 elsif p_action in('start','finish','cancel') then
  select * into job from public.fsm_jobs where id=ident and company_id=p_company for update;
  if not found then raise exception 'Serviço inválido';end if;
  if p_action<>'cancel' and not exists(select 1 from public.fsm_team_members m join public.fsm_teams t on t.id=m.team_id where m.team_id=job.team_id and m.user_id=uid and t.leader_id=uid and t.active) then raise exception 'Só o responsável da equipa pode iniciar ou terminar o serviço';end if;
  if p_action='start' then
   if job.status<>'scheduled' then raise exception 'O serviço já foi iniciado ou encerrado';end if;
   update public.fsm_jobs set status='progress',started_at=now(),started_by=uid where id=ident;
   if job.source_type='maintenance' then update public.maintenance set status='progress' where id=job.source_id and status='scheduled';end if;
  elsif p_action='finish' then
   if job.status<>'progress' then raise exception 'Inicie primeiro o serviço';end if;
   if length(trim(coalesce(p_data->>'report',''))) not between 5 and 20000 then raise exception 'Preencha o relatório (5 a 20000 caracteres)';end if;
   items:=p_data->'answers';if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)<>jsonb_array_length(job.checklist) then raise exception 'Preencha todos os afazeres';end if;
   for entry in select value from jsonb_array_elements(items) loop
    if coalesce(entry->>'status','') not in('done','not_done','na') or ((entry->>'status')<>'done' and length(trim(coalesce(entry->>'note','')))<3) then raise exception 'Justifique os afazeres não realizados ou não aplicáveis';end if;
   end loop;
   update public.fsm_jobs set status='completed',answers=items,report=p_data->>'report',completed_at=now(),completed_by=uid where id=ident;
   if job.source_type='maintenance' then update public.maintenance set status=case when exists(select 1 from jsonb_array_elements(items) a where a->>'status'='not_done') then 'scheduled' else 'done' end,completed_at=case when exists(select 1 from jsonb_array_elements(items) a where a->>'status'='not_done') then null else now() end where id=job.source_id;end if;
   if job.source_type='periodic' then
    insert into public.periodic_service_visits(periodic_service_id,condominium_id,performed_by,result,notes) values(job.source_id,job.condominium_id,uid::text,case when exists(select 1 from jsonb_array_elements(items) a where a->>'status'='not_done') then 'partial' else 'done' end,p_data->>'report');
    update public.periodic_services set last_service_on=(now() at time zone 'Europe/Lisbon')::date where id=job.source_id;
   end if;
  else
   if job.status<>'scheduled' then raise exception 'Só pode cancelar serviços ainda não iniciados';end if;
   update public.fsm_jobs set status='cancelled' where id=ident;
  end if;
  insert into public.fsm_events(job_id,user_id,action) values(ident,uid,p_action);
 else raise exception 'Ação inválida';end if;
 return '{"ok":true}';
end $$;
