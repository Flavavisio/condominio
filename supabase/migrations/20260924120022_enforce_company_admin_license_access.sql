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
          and private.has_active_company_admin_license(cm.company_id, cm.user_id)
      );
$$;

create or replace function private.can_view_condo(target_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or private.is_condo_member(target_condominium_id)
      or private.is_staff_assigned_to_condo(target_condominium_id)
      or exists (
        select 1
        from public.condominiums c
        where c.id = target_condominium_id
          and private.is_company_admin(c.company_id)
      );
$$;

create or replace function private.can_manage_condo(target_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or private.is_staff_assigned_to_condo(target_condominium_id)
      or exists (
        select 1
        from public.condominiums c
        where c.id = target_condominium_id
          and private.is_company_admin(c.company_id)
      );
$$;

create or replace function public.has_my_active_company_admin_license(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or private.has_active_company_admin_license(p_company_id, (select auth.uid()));
$$;

revoke all on function public.has_my_active_company_admin_license(uuid) from public, anon;
grant execute on function public.has_my_active_company_admin_license(uuid) to authenticated;
