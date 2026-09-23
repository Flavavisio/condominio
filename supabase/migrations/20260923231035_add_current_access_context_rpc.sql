create or replace function public.get_my_access_context()
returns table (
  user_id uuid,
  full_name text,
  phone text,
  avatar_url text,
  is_super_admin boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.user_id,
    p.full_name,
    p.phone,
    p.avatar_url,
    p.is_super_admin
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_access_context() from public, anon;
grant execute on function public.get_my_access_context() to authenticated;
