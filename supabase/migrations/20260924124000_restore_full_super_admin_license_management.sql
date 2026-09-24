create or replace function public.update_company_admin_license(
  p_license_id uuid,
  p_billing_cycle text,
  p_starts_on date,
  p_expires_on date,
  p_notes text default null
)
returns public.company_admin_licenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.company_admin_licenses;
begin
  if not private.is_super_admin() then
    raise exception 'Sem permissões.' using errcode='42501';
  end if;
  if p_billing_cycle not in ('monthly','annual') then
    raise exception 'Ciclo inválido.';
  end if;
  if p_starts_on is null or p_expires_on is null or p_expires_on < p_starts_on then
    raise exception 'Datas de validade inválidas.';
  end if;

  update public.company_admin_licenses
     set billing_cycle = p_billing_cycle,
         starts_on = p_starts_on,
         expires_on = p_expires_on,
         notes = nullif(trim(p_notes),''),
         status = case
           when status = 'cancelled' then status
           when p_expires_on < current_date then 'expired'
           else status
         end,
         updated_at = now()
   where id = p_license_id
   returning * into v;

  if v.id is null then raise exception 'Licença não encontrada.'; end if;
  return v;
end;
$$;

revoke all on function public.update_company_admin_license(uuid,text,date,date,text) from public, anon;
grant execute on function public.update_company_admin_license(uuid,text,date,date,text) to authenticated;
