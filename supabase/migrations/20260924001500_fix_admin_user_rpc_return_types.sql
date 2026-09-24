create or replace function public.list_pending_users()
returns table(
  user_id uuid,
  full_name text,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Apenas o Super Admin pode listar contas pendentes.' using errcode = '42501';
  end if;

  return query
  select
    p.user_id,
    coalesce(nullif(p.full_name,''), u.email::text)::text as full_name,
    u.email::text as email,
    p.created_at::timestamptz as created_at
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where coalesce(p.is_super_admin,false) = false
    and not exists (
      select 1 from public.company_members cm
      where cm.user_id = p.user_id and cm.status = 'active'
    )
    and not exists (
      select 1 from public.condominium_members cdm
      where cdm.user_id = p.user_id and cdm.status = 'active'
    )
  order by p.created_at desc;
end;
$$;

create or replace function public.list_company_users(p_company_id uuid)
returns table(
  member_id uuid,
  user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_company_admin(p_company_id) then
    raise exception 'Sem permissões para consultar esta empresa.' using errcode = '42501';
  end if;

  return query
  select
    cm.id::uuid as member_id,
    cm.user_id::uuid as user_id,
    coalesce(nullif(p.full_name,''), u.email::text)::text as full_name,
    u.email::text as email,
    cm.role::text as role,
    cm.status::text as status,
    cm.created_at::timestamptz as created_at
  from public.company_members cm
  join auth.users u on u.id = cm.user_id
  left join public.profiles p on p.user_id = cm.user_id
  where cm.company_id = p_company_id
  order by cm.created_at asc;
end;
$$;
