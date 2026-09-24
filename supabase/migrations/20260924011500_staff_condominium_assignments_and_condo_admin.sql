create table if not exists public.condominium_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominium_id, user_id)
);

alter table public.condominium_staff_assignments enable row level security;

alter table public.condominium_members
  add column if not exists is_condominium_admin boolean not null default false;

create or replace function private.is_staff_assigned_to_condo(target_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.condominium_staff_assignments a
       where a.condominium_id = target_condominium_id
         and a.user_id = (select auth.uid())
         and a.status = 'active'
     );
$$;

create or replace function private.is_condominium_admin(target_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.condominium_members cm
       where cm.condominium_id = target_condominium_id
         and cm.user_id = (select auth.uid())
         and cm.status = 'active'
         and cm.is_condominium_admin = true
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
        join public.company_members cm on cm.company_id = c.company_id
        where c.id = target_condominium_id
          and cm.user_id = (select auth.uid())
          and cm.status = 'active'
          and cm.role = 'admin'
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
        join public.company_members cm on cm.company_id = c.company_id
        where c.id = target_condominium_id
          and cm.user_id = (select auth.uid())
          and cm.status = 'active'
          and cm.role = 'admin'
      );
$$;

create or replace function private.can_administer_condo_as_resident(target_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or private.can_manage_condo(target_condominium_id)
      or private.is_condominium_admin(target_condominium_id);
$$;

create policy condominium_staff_assignments_select on public.condominium_staff_assignments
for select using (
  private.is_super_admin()
  or private.can_view_condo(condominium_id)
  or exists (
    select 1 from public.condominiums c
    where c.id = condominium_id
      and private.is_company_admin(c.company_id)
  )
);

create policy condominium_staff_assignments_insert on public.condominium_staff_assignments
for insert with check (
  exists (
    select 1 from public.condominiums c
    where c.id = condominium_id
      and private.is_company_admin(c.company_id)
  )
);

create policy condominium_staff_assignments_update on public.condominium_staff_assignments
for update using (
  exists (
    select 1 from public.condominiums c
    where c.id = condominium_id
      and private.is_company_admin(c.company_id)
  )
) with check (
  exists (
    select 1 from public.condominiums c
    where c.id = condominium_id
      and private.is_company_admin(c.company_id)
  )
);

create policy condominium_staff_assignments_delete on public.condominium_staff_assignments
for delete using (
  exists (
    select 1 from public.condominiums c
    where c.id = condominium_id
      and private.is_company_admin(c.company_id)
  )
);

grant select, insert, update, delete on public.condominium_staff_assignments to authenticated;

create index if not exists idx_condo_staff_user_status on public.condominium_staff_assignments(user_id, status);
create index if not exists idx_condo_staff_condo_status on public.condominium_staff_assignments(condominium_id, status);

create or replace function public.set_company_user_condominiums(
  p_company_id uuid,
  p_user_id uuid,
  p_condominium_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_company_admin(p_company_id) then
    raise exception 'Sem permissões para gerir atribuições desta empresa.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
      and cm.role in ('manager','staff')
  ) then
    raise exception 'O utilizador deve ser Gestor ou Funcionário ativo desta empresa.';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_condominium_ids, '{}'::uuid[])) x(id)
    left join public.condominiums c on c.id = x.id and c.company_id = p_company_id
    where c.id is null
  ) then
    raise exception 'Existe pelo menos um condomínio que não pertence à empresa.';
  end if;

  delete from public.condominium_staff_assignments a
  using public.condominiums c
  where a.condominium_id = c.id
    and c.company_id = p_company_id
    and a.user_id = p_user_id
    and not (a.condominium_id = any(coalesce(p_condominium_ids, '{}'::uuid[])));

  insert into public.condominium_staff_assignments(condominium_id, user_id, assigned_by, status)
  select c.id, p_user_id, (select auth.uid()), 'active'
  from public.condominiums c
  where c.company_id = p_company_id
    and c.id = any(coalesce(p_condominium_ids, '{}'::uuid[]))
  on conflict (condominium_id, user_id) do update
    set status = 'active', updated_at = now(), assigned_by = (select auth.uid());
end;
$$;

grant execute on function public.set_company_user_condominiums(uuid, uuid, uuid[]) to authenticated;

create or replace function public.set_condominium_resident_admin(
  p_condominium_id uuid,
  p_user_id uuid,
  p_is_admin boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_condo(p_condominium_id) then
    raise exception 'Sem permissões para gerir o administrador deste condomínio.' using errcode = '42501';
  end if;

  update public.condominium_members
  set is_condominium_admin = coalesce(p_is_admin, false)
  where condominium_id = p_condominium_id
    and user_id = p_user_id
    and status = 'active';

  if not found then
    raise exception 'O utilizador não é um condómino ativo deste condomínio.';
  end if;
end;
$$;

grant execute on function public.set_condominium_resident_admin(uuid, uuid, boolean) to authenticated;