create or replace function public.list_pending_users()
returns table(user_id uuid, full_name text, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Apenas o Super Admin pode listar contas pendentes.' using errcode = '42501';
  end if;

  return query
  select p.user_id, coalesce(nullif(p.full_name,''), u.email), u.email, p.created_at
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

create or replace function public.activate_company_user(p_user_id uuid, p_company_id uuid, p_role text default 'admin')
returns public.company_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.company_members;
begin
  if not private.is_super_admin() then
    raise exception 'Apenas o Super Admin pode ativar contas pendentes.' using errcode = '42501';
  end if;
  if p_role not in ('admin','manager','staff') then
    raise exception 'Perfil inválido.';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa não encontrada.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Utilizador não encontrado.';
  end if;

  insert into public.company_members(company_id,user_id,role,status)
  values (p_company_id,p_user_id,p_role,'active')
  on conflict (company_id,user_id) do update
    set role = excluded.role,
        status = 'active'
  returning * into result;

  return result;
end;
$$;

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
  select cm.id, cm.user_id, coalesce(nullif(p.full_name,''), u.email), u.email, cm.role, cm.status, cm.created_at
  from public.company_members cm
  join auth.users u on u.id = cm.user_id
  left join public.profiles p on p.user_id = cm.user_id
  where cm.company_id = p_company_id
  order by cm.created_at asc;
end;
$$;

grant execute on function public.list_pending_users() to authenticated;
grant execute on function public.activate_company_user(uuid,uuid,text) to authenticated;
grant execute on function public.list_company_users(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-branding','company-branding',true,5242880,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company_branding_insert" on storage.objects;
drop policy if exists "company_branding_update" on storage.objects;
drop policy if exists "company_branding_delete" on storage.objects;

create policy "company_branding_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'company-branding'
  and private.is_company_admin(((storage.foldername(name))[1])::uuid)
);

create policy "company_branding_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'company-branding'
  and private.is_company_admin(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'company-branding'
  and private.is_company_admin(((storage.foldername(name))[1])::uuid)
);

create policy "company_branding_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'company-branding'
  and private.is_company_admin(((storage.foldername(name))[1])::uuid)
);
