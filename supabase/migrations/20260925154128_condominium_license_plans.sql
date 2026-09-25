create table public.license_plans (
 id text primary key,
 name text not null,
 condominium_limit integer not null unique check(condominium_limit>0),
 monthly_price numeric(12,2) not null check(monthly_price>0),
 vat_included boolean not null default true,
 active boolean not null default true
);
insert into public.license_plans(id,name,condominium_limit,monthly_price) values
 ('condomia_1','Condomia 1',1,11.90),('condomia_10','Condomia 10',10,80),
 ('condomia_50','Condomia 50',50,380),('condomia_100','Condomia 100',100,650),('condomia_200','Condomia 200',200,1200);
alter table public.license_plans enable row level security;
grant select on public.license_plans to anon,authenticated;
create policy license_plans_read on public.license_plans for select to anon,authenticated using(active);
alter table public.company_admin_licenses
 add column plan_id text references public.license_plans(id),
 add column condominium_limit integer check(condominium_limit>0),
 add column monthly_price numeric(12,2) check(monthly_price>0),
 add column vat_included boolean not null default true;
alter table public.companies
 add column license_plan_id text references public.license_plans(id),
 add column licensed_condominium_limit integer check(licensed_condominium_limit>0);
create index licenses_plan on public.company_admin_licenses(plan_id);
create index companies_license_plan on public.companies(license_plan_id);

-- One shared capacity per management company, never summed across its administrators.
create function private.protect_company_plan() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.license_plans; used integer;
begin
 if TG_OP='INSERT' or new.license_plan_id is distinct from old.license_plan_id or new.licensed_condominium_limit is distinct from old.licensed_condominium_limit then
   if new.license_plan_id is not null then
     if not private.is_super_admin() then raise exception 'Só o Super Admin pode alterar o plano.' using errcode='42501';end if;
     select * into p from public.license_plans where id=new.license_plan_id and active;
     if not found then raise exception 'Plano inválido.';end if;
     perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text,921));
     select count(*) into used from public.condominiums where company_id=new.id;
     if used>p.condominium_limit then raise exception 'A empresa gere % condomínios. Escolha um plano com capacidade suficiente.',used;end if;
     new.licensed_condominium_limit:=p.condominium_limit;new.plan:=p.name;new.monthly_fee:=p.monthly_price;
   elsif TG_OP='UPDATE' and old.license_plan_id is not null then
     raise exception 'Não pode remover o plano de uma empresa licenciada.';
   end if;
 end if;
 if new.license_plan_id is not null then
   select * into p from public.license_plans where id=new.license_plan_id;
   new.licensed_condominium_limit:=p.condominium_limit;new.plan:=p.name;new.monthly_fee:=p.monthly_price;
 end if;
 return new;
end;
$$;
revoke all on function private.protect_company_plan() from public,anon,authenticated;
create trigger company_plan_guard before insert or update on public.companies for each row execute function private.protect_company_plan();

create function private.enforce_condominium_capacity() returns trigger language plpgsql security invoker set search_path='' as $$
declare cap integer; used integer;
begin
 if TG_OP='UPDATE' and new.company_id=old.company_id then return new;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.company_id::text,921));
 select licensed_condominium_limit into cap from public.companies where id=new.company_id;
 if cap is null then return new;end if; -- Existing legacy companies retain their current access.
 select count(*) into used from public.condominiums where company_id=new.company_id and id<>new.id;
 if used>=cap then raise exception 'Limite de % condomínios atingido. Peça a alteração do plano ao Super Admin.',cap;end if;
 return new;
end;
$$;
revoke all on function private.enforce_condominium_capacity() from public,anon,authenticated;
create trigger condominium_capacity_guard before insert or update of company_id on public.condominiums for each row execute function private.enforce_condominium_capacity();

create function public.issue_planned_company_license(p_company_id uuid,p_user_id uuid,p_billing_cycle text,p_starts_on date,p_plan_id text,p_notes text default null)
returns public.company_admin_licenses language plpgsql security invoker set search_path='' as $$
declare p public.license_plans; result public.company_admin_licenses;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 select * into p from public.license_plans where id=p_plan_id and active;
 if not found then raise exception 'Selecione um plano válido.';end if;
 update public.companies set license_plan_id=p.id,licensed_condominium_limit=p.condominium_limit where id=p_company_id;
 result:=public.issue_company_admin_license(p_company_id,p_user_id,p_billing_cycle,p_starts_on,p_notes);
 update public.company_admin_licenses set plan_id=p.id,condominium_limit=p.condominium_limit,monthly_price=p.monthly_price,vat_included=p.vat_included where id=result.id returning * into result;
 return result;
end;
$$;
create function public.update_planned_company_license(p_license_id uuid,p_billing_cycle text,p_starts_on date,p_expires_on date,p_plan_id text,p_notes text default null)
returns public.company_admin_licenses language plpgsql security invoker set search_path='' as $$
declare p public.license_plans; result public.company_admin_licenses;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 select * into p from public.license_plans where id=p_plan_id and active;
 if not found then raise exception 'Selecione um plano válido.';end if;
 select * into result from public.company_admin_licenses where id=p_license_id;
 if not found then raise exception 'Licença não encontrada.';end if;
 update public.companies set license_plan_id=p.id,licensed_condominium_limit=p.condominium_limit where id=result.company_id;
 result:=public.update_company_admin_license(p_license_id,p_billing_cycle,p_starts_on,p_expires_on,p_notes);
 update public.company_admin_licenses set plan_id=p.id,condominium_limit=p.condominium_limit,monthly_price=p.monthly_price,vat_included=p.vat_included where id=result.id returning * into result;
 return result;
end;
$$;
revoke all on function public.issue_planned_company_license(uuid,uuid,text,date,text,text),public.update_planned_company_license(uuid,text,date,date,text,text) from public,anon;
grant execute on function public.issue_planned_company_license(uuid,uuid,text,date,text,text),public.update_planned_company_license(uuid,text,date,date,text,text) to authenticated;
