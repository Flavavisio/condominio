create or replace function private.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or exists (
        select 1
        from public.company_members cm
        where cm.company_id = target_company_id
          and cm.user_id = (select auth.uid())
          and cm.status = 'active'
          and cm.role = 'admin'
      );
$$;

drop policy if exists company_members_select on public.company_members;
create policy company_members_select
on public.company_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_company_admin(company_id)
  or private.is_super_admin()
);

create or replace function public.set_staff_condominium_assignments(
  p_user_id uuid,
  p_condominium_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_role text;
  v_count integer := 0;
begin
  select cm.company_id, cm.role
    into v_company_id, v_role
  from public.company_members cm
  where cm.user_id = p_user_id
    and cm.status = 'active'
    and cm.role in ('manager','staff')
    and private.is_company_admin(cm.company_id)
  limit 1;

  if v_company_id is null then
    raise exception 'Funcionário/Gestor não encontrado nesta empresa ou sem permissões.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_condominium_ids, '{}'::uuid[])) as x(id)
    left join public.condominiums c on c.id = x.id
    where c.id is null or c.company_id <> v_company_id
  ) then
    raise exception 'Um dos condomínios não pertence à empresa.' using errcode = '22023';
  end if;

  delete from public.condominium_staff_assignments a
  using public.condominiums c
  where a.condominium_id = c.id
    and c.company_id = v_company_id
    and a.user_id = p_user_id;

  insert into public.condominium_staff_assignments (
    condominium_id, user_id, assigned_by, status
  )
  select distinct x.id, p_user_id, (select auth.uid()), 'active'
  from unnest(coalesce(p_condominium_ids, '{}'::uuid[])) as x(id)
  join public.condominiums c on c.id = x.id
  where c.company_id = v_company_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_staff_condominium_assignments(uuid, uuid[]) from public, anon;
grant execute on function public.set_staff_condominium_assignments(uuid, uuid[]) to authenticated;
