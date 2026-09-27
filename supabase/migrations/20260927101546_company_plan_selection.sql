create function public.set_company_license_plan(p_company_id uuid,p_plan_id text,p_extra_packs integer default 0)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.license_plans;
begin
 if not private.is_super_admin() then raise exception 'Apenas o Super Admin pode alterar planos.' using errcode='42501';end if;
 if p_extra_packs is null or p_extra_packs<0 or p_extra_packs>1000 then raise exception 'Packs inválidos.';end if;
 select * into p from public.license_plans where id=p_plan_id and active;
 if not found then raise exception 'Plano indisponível.';end if;
 update public.companies set license_plan_id=p.id,extra_packs=p_extra_packs where id=p_company_id;
 if not found then raise exception 'Empresa não encontrada.';end if;
 update public.company_admin_licenses set plan_id=p.id,extra_packs=p_extra_packs,condominium_limit=p.condominium_limit+p_extra_packs*10,monthly_price=p.monthly_price+p_extra_packs*80,vat_included=p.vat_included where company_id=p_company_id and status='active';
end $$;
revoke all on function public.set_company_license_plan(uuid,text,integer) from public,anon;
grant execute on function public.set_company_license_plan(uuid,text,integer) to authenticated;
