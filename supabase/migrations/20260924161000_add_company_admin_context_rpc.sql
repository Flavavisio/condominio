create or replace function public.get_my_company_admin_context()
returns table (
  company_id uuid,
  company_name text,
  company_label text,
  member_role text,
  member_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         c.name::text,
         c.label::text,
         cm.role::text,
         cm.status::text
  from public.company_members cm
  join public.companies c on c.id = cm.company_id
  where cm.user_id = (select auth.uid())
    and cm.status = 'active'
    and cm.role = 'admin'
  order by cm.created_at asc
  limit 1;
$$;

revoke all on function public.get_my_company_admin_context() from public;
revoke all on function public.get_my_company_admin_context() from anon;
grant execute on function public.get_my_company_admin_context() to authenticated;
