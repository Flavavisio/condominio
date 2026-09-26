-- Additional packs are shared company capacity; no change to existing subscriptions.
alter table public.companies add column extra_packs integer not null default 0 check(extra_packs between 0 and 1000);
alter table public.company_admin_licenses add column extra_packs integer not null default 0 check(extra_packs between 0 and 1000);
create or replace function private.protect_company_plan() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.license_plans; used integer;
begin
 if TG_OP='INSERT' or new.license_plan_id is distinct from old.license_plan_id or new.licensed_condominium_limit is distinct from old.licensed_condominium_limit or new.extra_packs is distinct from old.extra_packs then
   if new.license_plan_id is not null then
     if not private.is_super_admin() then raise exception 'Só o Super Admin pode alterar o plano.' using errcode='42501';end if;
     select * into p from public.license_plans where id=new.license_plan_id and active;
     if not found then raise exception 'Plano inválido.';end if;
     perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text,921));
     select count(*) into used from public.condominiums where company_id=new.id;
     if p.condominium_limit=1 and new.extra_packs>0 then raise exception 'Os packs adicionais exigem um plano base de pelo menos 10 condomínios.';end if;
     if used>p.condominium_limit+new.extra_packs*10 then raise exception 'A empresa gere % condomínios. Escolha um plano com capacidade suficiente.',used;end if;
     new.licensed_condominium_limit:=p.condominium_limit+new.extra_packs*10;new.plan:=p.name;new.monthly_fee:=p.monthly_price+new.extra_packs*80;
   elsif TG_OP='UPDATE' and old.license_plan_id is not null then
     raise exception 'Não pode remover o plano de uma empresa licenciada.';
   end if;
 end if;
 if new.license_plan_id is not null then
   select * into p from public.license_plans where id=new.license_plan_id;
   new.licensed_condominium_limit:=p.condominium_limit+new.extra_packs*10;new.plan:=p.name;new.monthly_fee:=p.monthly_price+new.extra_packs*80;
 end if;
 if new.license_plan_id is null and new.extra_packs<>0 then raise exception 'Selecione um plano base antes de adicionar packs.';end if;
 return new;
end;
$$;

-- Replace the signatures to avoid ambiguous PostgREST overloads. Existing callers default to zero packs.
drop function public.issue_planned_company_license(uuid,uuid,text,date,text,text);
drop function public.update_planned_company_license(uuid,text,date,date,text,text);
create function public.issue_planned_company_license(p_company_id uuid,p_user_id uuid,p_billing_cycle text,p_starts_on date,p_plan_id text,p_notes text default null,p_extra_packs integer default 0)
returns public.company_admin_licenses language plpgsql security invoker set search_path='' as $$
declare p public.license_plans; result public.company_admin_licenses;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 if p_extra_packs is null or p_extra_packs<0 or p_extra_packs>1000 then raise exception 'Quantidade de packs inválida.';end if;
 select * into p from public.license_plans where id=p_plan_id and active;
 if not found then raise exception 'Selecione um plano válido.';end if;
 update public.companies set license_plan_id=p.id,extra_packs=p_extra_packs,licensed_condominium_limit=p.condominium_limit+p_extra_packs*10 where id=p_company_id;
 result:=public.issue_company_admin_license(p_company_id,p_user_id,p_billing_cycle,p_starts_on,p_notes);
 update public.company_admin_licenses set plan_id=p.id,extra_packs=p_extra_packs,condominium_limit=p.condominium_limit+p_extra_packs*10,monthly_price=p.monthly_price+p_extra_packs*80,vat_included=p.vat_included where id=result.id returning * into result;
 return result;
end;
$$;
create function public.update_planned_company_license(p_license_id uuid,p_billing_cycle text,p_starts_on date,p_expires_on date,p_plan_id text,p_notes text default null,p_extra_packs integer default 0)
returns public.company_admin_licenses language plpgsql security invoker set search_path='' as $$
declare p public.license_plans; result public.company_admin_licenses;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 if p_extra_packs is null or p_extra_packs<0 or p_extra_packs>1000 then raise exception 'Quantidade de packs inválida.';end if;
 select * into p from public.license_plans where id=p_plan_id and active;
 if not found then raise exception 'Selecione um plano válido.';end if;
 select * into result from public.company_admin_licenses where id=p_license_id;
 if not found then raise exception 'Licença não encontrada.';end if;
 update public.companies set license_plan_id=p.id,extra_packs=p_extra_packs,licensed_condominium_limit=p.condominium_limit+p_extra_packs*10 where id=result.company_id;
 result:=public.update_company_admin_license(p_license_id,p_billing_cycle,p_starts_on,p_expires_on,p_notes);
 update public.company_admin_licenses set plan_id=p.id,extra_packs=p_extra_packs,condominium_limit=p.condominium_limit+p_extra_packs*10,monthly_price=p.monthly_price+p_extra_packs*80,vat_included=p.vat_included where id=result.id returning * into result;
 return result;
end;
$$;

revoke all on function public.issue_planned_company_license(uuid,uuid,text,date,text,text,integer),public.update_planned_company_license(uuid,text,date,date,text,text,integer) from public,anon;
grant execute on function public.issue_planned_company_license(uuid,uuid,text,date,text,text,integer),public.update_planned_company_license(uuid,text,date,date,text,text,integer) to authenticated;
