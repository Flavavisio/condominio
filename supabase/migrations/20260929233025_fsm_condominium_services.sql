-- Teams contain account holders and named colleagues without login.
alter table public.company_members add column display_name text check(length(display_name) between 1 and 160);
alter table public.fsm_teams add column member_names jsonb not null default '[]' check(jsonb_typeof(member_names)='array'), add column archived_at timestamptz;
alter table public.fsm_checklists alter column condominium_id drop not null;
alter table public.fsm_jobs alter column team_id drop not null;
alter table public.fsm_jobs add column provider_type text not null default 'internal' check(provider_type in('internal','external')),
 add column supplier_id uuid references public.suppliers(id) on delete restrict,
 add column leader_id uuid references auth.users(id) on delete set null,
 add column team_snapshot jsonb not null default '{}';
create index fsm_jobs_leader_idx on public.fsm_jobs(leader_id,status);
create index fsm_jobs_supplier_idx on public.fsm_jobs(supplier_id);
alter table public.fsm_jobs add constraint fsm_jobs_provider_check check((provider_type='internal' and team_id is not null and supplier_id is null) or (provider_type='external' and team_id is null and supplier_id is not null));
create function private.fsm_team_snapshot(p_team uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',t.name,'leader_name',coalesce(cm.display_name,p.full_name,'Responsável'),'members',t.member_names||coalesce((select jsonb_agg(coalesce(m.display_name,pr.full_name,'Colaborador')) from public.fsm_team_members tm join public.company_members m on m.user_id=tm.user_id and m.company_id=t.company_id left join public.profiles pr on pr.user_id=m.user_id where tm.team_id=t.id and tm.user_id<>t.leader_id),'[]')) from public.fsm_teams t left join public.company_members cm on cm.company_id=t.company_id and cm.user_id=t.leader_id left join public.profiles p on p.user_id=t.leader_id where t.id=p_team;
$$;
revoke all on function private.fsm_team_snapshot(uuid) from public,anon,authenticated;
update public.fsm_jobs j set leader_id=t.leader_id,team_snapshot=private.fsm_team_snapshot(t.id) from public.fsm_teams t where t.id=j.team_id;

create or replace function private.fsm_api(p_company uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare uid uuid:=auth.uid(); sa boolean; admin boolean; member_role text; enabled boolean; ident uuid; condo uuid; team uuid; provider text; chief uuid; snapshot jsonb; job public.fsm_jobs; items jsonb; entry jsonb; checklist_id text; result jsonb; offset_n integer:=greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));
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
  'people',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',cm.user_id,'name',coalesce(cm.display_name,p.full_name,u.email),'email',u.email,'role',cm.role)) from public.company_members cm join auth.users u on u.id=cm.user_id left join public.profiles p on p.user_id=cm.user_id where cm.company_id=p_company and cm.status='active'),'[]') else '[]'::jsonb end,
  'condos',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'address',c.address)) from public.condominiums c where c.company_id=p_company and (admin or exists(select 1 from public.fsm_jobs j join public.fsm_team_members tm on tm.team_id=j.team_id where j.condominium_id=c.id and tm.user_id=uid))),'[]'),
  'checklists',case when admin then coalesce((select jsonb_agg(to_jsonb(c)) from public.fsm_checklists c where company_id=p_company),'[]') else '[]'::jsonb end,
  'jobs',coalesce((select jsonb_agg(to_jsonb(x)) from (select j.*,coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'at',e.created_at,'user',e.user_id) order by e.created_at) from public.fsm_events e where e.job_id=j.id),'[]') events from public.fsm_jobs j where j.company_id=p_company and (nullif(p_data->>'condominium_id','') is null or j.condominium_id=(p_data->>'condominium_id')::uuid) and (admin or j.leader_id=uid) order by j.scheduled_for desc,j.id limit 50 offset offset_n) x),'[]'),
  'total',(select count(*) from public.fsm_jobs j where j.company_id=p_company and (nullif(p_data->>'condominium_id','') is null or j.condominium_id=(p_data->>'condominium_id')::uuid) and (admin or j.leader_id=uid)),
  'suppliers',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'condominium_id',s.condominium_id)) from public.suppliers s join public.condominiums c on c.id=s.condominium_id where c.company_id=p_company),'[]') else '[]'::jsonb end,
  'sources',case when admin then coalesce((select jsonb_agg(x) from (select id,condominium_id,title,'maintenance' as kind from public.maintenance where condominium_id in(select id from public.condominiums where company_id=p_company) and status='scheduled' union all select id,condominium_id,title,'periodic' from public.periodic_services where condominium_id in(select id from public.condominiums where company_id=p_company) and active) x),'[]') else '[]'::jsonb end);
 end if;
 if not coalesce(enabled,false) then raise exception 'Ative o módulo FSM.';end if;
 if p_action in('team','team_delete','checklist','job','cancel') and not admin then raise exception 'Apenas administrador' using errcode='42501';end if;
 ident:=nullif(p_data->>'id','')::uuid;
 if p_action='team_delete' then
  perform 1 from public.fsm_teams where id=ident and company_id=p_company for update;
  if not found then raise exception 'Equipa inválida';end if;
  if exists(select 1 from public.fsm_jobs where team_id=ident and status in('scheduled','progress')) then raise exception 'Conclua ou cancele os serviços pendentes antes de apagar a equipa';end if;
  update public.fsm_teams set active=false,archived_at=now() where id=ident;
 elsif p_action='team' then
  if ident is not null then
   perform 1 from public.fsm_teams where id=ident and company_id=p_company and archived_at is null for update;
   if not found then raise exception 'Equipa inválida';end if;
   if exists(select 1 from public.fsm_jobs where team_id=ident and status='progress') and exists(select 1 from public.fsm_teams where id=ident and (leader_id is distinct from (p_data->>'leader_id')::uuid or not coalesce((p_data->>'active')::boolean,true))) then raise exception 'Termine o serviço em execução antes de mudar o responsável ou desativar a equipa';end if;
  end if;
  items:=coalesce(p_data->'member_names','[]');
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>100 then raise exception 'Indique até 100 elementos';end if;
  for entry in select value from jsonb_array_elements(items) loop if jsonb_typeof(entry) is distinct from 'string' or length(trim(entry#>>'{}')) not between 1 and 120 then raise exception 'Nome de elemento inválido';end if;end loop;
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
  update public.fsm_teams set leader_id=(p_data->>'leader_id')::uuid,member_names=items where id=ident;
  -- Pending orders follow a change of chief; completed records keep their snapshot.
  update public.fsm_jobs j set leader_id=t.leader_id,team_snapshot=private.fsm_team_snapshot(t.id) from public.fsm_teams t where j.team_id=t.id and t.id=ident and j.status='scheduled';
 elsif p_action='checklist' then
  condo:=nullif(p_data->>'condominium_id','')::uuid;
  if condo is not null and not exists(select 1 from public.condominiums where id=condo and company_id=p_company) then raise exception 'Condomínio inválido';end if;
  items:=p_data->'items';if jsonb_typeof(items) is distinct from 'array' then raise exception 'Checklist inválida';end if;
  for entry in select value from jsonb_array_elements(items) loop if jsonb_typeof(entry) is distinct from 'string' or length(trim(entry#>>'{}')) not between 1 and 300 then raise exception 'Afazer inválido';end if;end loop;
  if ident is null then insert into public.fsm_checklists(company_id,condominium_id,name,items) values(p_company,condo,p_data->>'name',items);
  else update public.fsm_checklists set name=p_data->>'name',items=items,active=coalesce((p_data->>'active')::boolean,true) where id=ident and company_id=p_company ;if not found then raise exception 'Checklist inválida';end if;end if;
 elsif p_action='job' then
  condo:=(p_data->>'condominium_id')::uuid;team:=nullif(p_data->>'team_id','')::uuid;
  provider:=coalesce(p_data->>'provider_type','internal');
  if not exists(select 1 from public.condominiums where id=condo and company_id=p_company and status='active') then raise exception 'Condomínio inválido';end if;
  if provider='internal' then
   select leader_id into chief from public.fsm_teams where id=team and company_id=p_company and active and archived_at is null for update;
   if chief is null or not exists(select 1 from public.company_members where company_id=p_company and user_id=chief and status='active') then raise exception 'Escolha uma equipa com responsável ativo';end if;
   if nullif(p_data->>'leader_id','') is not null and (p_data->>'leader_id')::uuid<>chief then raise exception 'O responsável da equipa mudou. Atualize o formulário';end if;
   snapshot:=private.fsm_team_snapshot(team);
  elsif provider='external' then
   team:=null;chief:=null;snapshot:='{}';
   if not exists(select 1 from public.suppliers where id=nullif(p_data->>'supplier_id','')::uuid and condominium_id=condo) then raise exception 'Escolha um fornecedor deste condomínio';end if;
  else raise exception 'Prestador inválido';end if;
  items:='[]';
  for checklist_id in select jsonb_array_elements_text(p_data->'checklists') loop
   select jsonb_agg(jsonb_build_object('task',value#>>'{}','checklist',c.name)) into result from public.fsm_checklists c cross join lateral jsonb_array_elements(c.items) where c.id=checklist_id::uuid and (c.condominium_id is null or c.condominium_id=condo) and c.company_id=p_company and c.active;
   if result is null then raise exception 'Checklist de outro condomínio ou inativa';end if;items:=items||result;
  end loop;
  for entry in select value from jsonb_array_elements(coalesce(p_data->'tasks','[]')) loop
   if jsonb_typeof(entry) is distinct from 'string' or length(trim(entry#>>'{}')) not between 1 and 300 then raise exception 'Afazer inválido';end if;
   items:=items||jsonb_build_array(jsonb_build_object('task',trim(entry#>>'{}'),'checklist','Checklist do serviço'));
  end loop;
  if jsonb_array_length(items)>300 then raise exception 'Máximo de 300 afazeres por serviço';end if;
  if p_data->>'source_type'='maintenance' and not exists(select 1 from public.maintenance where id=(p_data->>'source_id')::uuid and condominium_id=condo and status='scheduled') then raise exception 'Manutenção inválida';end if;
  if p_data->>'source_type'='periodic' and not exists(select 1 from public.periodic_services where id=(p_data->>'source_id')::uuid and condominium_id=condo and active) then raise exception 'Serviço periódico inválido';end if;
  if ident is not null then raise exception 'Crie nova ordem; cancele a anterior se necessário';end if;
  insert into public.fsm_jobs(company_id,condominium_id,team_id,title,scheduled_for,source_type,source_id,checklist,created_by,provider_type,supplier_id,leader_id,team_snapshot) values(p_company,condo,team,p_data->>'title',(p_data->>'scheduled_for')::timestamptz,coalesce(p_data->>'source_type','service'),nullif(p_data->>'source_id','')::uuid,items,uid,provider,case when provider='external' then (p_data->>'supplier_id')::uuid else null end,chief,snapshot) returning id into ident;
  insert into public.fsm_events(job_id,user_id,action) values(ident,uid,'created');
 elsif p_action in('start','progress','finish','cancel') then
  select * into job from public.fsm_jobs where id=ident and company_id=p_company for update;
  if not found then raise exception 'Serviço inválido';end if;
  if p_action<>'cancel' and not ((job.provider_type='external' and admin) or (job.provider_type='internal' and job.leader_id=uid and exists(select 1 from public.fsm_teams where id=job.team_id and active and archived_at is null))) then raise exception 'Só o responsável atribuído pode iniciar ou terminar o serviço';end if;
  if p_action='start' then
   if job.status<>'scheduled' then raise exception 'O serviço já foi iniciado ou encerrado';end if;
   update public.fsm_jobs set status='progress',started_at=now(),started_by=uid where id=ident;
   if job.source_type='maintenance' then update public.maintenance set status='progress' where id=job.source_id and status='scheduled';end if;
  elsif p_action in('progress','finish') then
   if job.status<>'progress' then raise exception 'Inicie primeiro o serviço';end if;
   if length(coalesce(p_data->>'report',''))>20000 then raise exception 'Observações demasiado longas';end if;
   items:=p_data->'answers';if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)<>jsonb_array_length(job.checklist) then raise exception 'Preencha todos os afazeres';end if;
   for entry in select value from jsonb_array_elements(items) loop
    if coalesce(entry->>'status','') not in('done','not_done') then raise exception 'Marque os afazeres feitos';end if;
   end loop;
   if p_action='progress' then
    update public.fsm_jobs set answers=items,worked_minutes=least(600000,greatest(0,floor(extract(epoch from (now()-job.started_at))/60)::integer)),report=nullif(trim(p_data->>'report'),'') where id=ident;return '{"ok":true}';
   end if;
   update public.fsm_jobs set status='completed',answers=items,worked_minutes=least(600000,greatest(0,floor(extract(epoch from (now()-job.started_at))/60)::integer)),report=coalesce(nullif(trim(p_data->>'report'),''),'Serviço concluído. '||(select count(*) from jsonb_array_elements(items) a where a->>'status'='done')||' de '||jsonb_array_length(items)||' afazeres feitos.'),completed_at=now(),completed_by=uid where id=ident;
   if job.source_type='maintenance' then update public.maintenance set status=case when exists(select 1 from jsonb_array_elements(items) a where a->>'status'='not_done') then 'scheduled' else 'done' end,completed_at=case when exists(select 1 from jsonb_array_elements(items) a where a->>'status'='not_done') then null else now() end where id=job.source_id;end if;
   if job.source_type='periodic' then
    insert into public.periodic_service_visits(periodic_service_id,condominium_id,performed_by,result,notes) values(job.source_id,job.condominium_id,'Equipa de serviço',case when exists(select 1 from jsonb_array_elements(items) a where a->>'status'='not_done') then 'partial' else 'done' end,'Execução registada');
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


-- Only a safe projection is exposed to residents, never team/checklist/notes.
create function private.condominium_service_schedule(p_condominium uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.can_view_condo(p_condominium),false) then raise exception 'Sem acesso ao condomínio' using errcode='42501';end if;
 return coalesce((select jsonb_agg(x order by x.scheduled_for desc) from (select id,title,scheduled_for,status from public.fsm_jobs where condominium_id=p_condominium and status<>'cancelled' order by scheduled_for desc limit 100) x),'[]');
end $$;
create function public.condominium_service_schedule(p_condominium uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.condominium_service_schedule(p_condominium)$$;
revoke all on function private.condominium_service_schedule(uuid),public.condominium_service_schedule(uuid) from public,anon;
grant execute on function private.condominium_service_schedule(uuid),public.condominium_service_schedule(uuid) to authenticated;

-- Edit/remove the company's relationship, never delete a shared Auth identity.
create function private.manage_company_employee(p_company uuid,p_user uuid,p_action text,p_name text default null,p_role text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.is_company_admin(p_company),false) then raise exception 'Apenas administrador da empresa' using errcode='42501';end if;
 perform 1 from public.company_members where company_id=p_company and user_id=p_user and role in('manager','staff') for update;
 if not found or p_user=auth.uid() then raise exception 'Colaborador inválido';end if;
 if p_action='edit' then
  if p_role not in('manager','staff') or p_role is null or length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception 'Nome ou função inválidos';end if;
  update public.company_members set display_name=trim(p_name),role=p_role where company_id=p_company and user_id=p_user;
 elsif p_action='delete' then
  if exists(select 1 from public.fsm_jobs where company_id=p_company and leader_id=p_user and status in('scheduled','progress')) then raise exception 'Mude o chefe da equipa ou conclua/cancele os serviços pendentes antes de retirar este funcionário';end if;
  update public.fsm_teams set leader_id=null where company_id=p_company and leader_id=p_user;
  delete from public.fsm_team_members where user_id=p_user and team_id in(select id from public.fsm_teams where company_id=p_company);
  delete from public.condominium_staff_assignments where user_id=p_user and condominium_id in(select id from public.condominiums where company_id=p_company);
  delete from public.company_members where company_id=p_company and user_id=p_user;
 else raise exception 'Ação inválida';end if;
 return true;
end $$;
create function public.manage_company_employee(p_company uuid,p_user uuid,p_action text,p_name text default null,p_role text default null) returns boolean language sql security invoker set search_path='' as $$select private.manage_company_employee(p_company,p_user,p_action,p_name,p_role)$$;
revoke all on function private.manage_company_employee(uuid,uuid,text,text,text),public.manage_company_employee(uuid,uuid,text,text,text) from public,anon;
grant execute on function private.manage_company_employee(uuid,uuid,text,text,text),public.manage_company_employee(uuid,uuid,text,text,text) to authenticated;
create or replace function public.list_company_users(p_company_id uuid)
returns table(member_id uuid, user_id uuid, full_name text, email text, role text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_company_admin(p_company_id) then
    raise exception 'Sem permissões para consultar esta empresa.' using errcode = '42501';
  end if;

  return query
  select cm.id, cm.user_id, coalesce(cm.display_name,nullif(p.full_name,''), u.email), u.email, cm.role, cm.status, cm.created_at
  from public.company_members cm
  join auth.users u on u.id = cm.user_id
  left join public.profiles p on p.user_id = cm.user_id
  where cm.company_id = p_company_id
  order by cm.created_at asc;
end;
$$;

