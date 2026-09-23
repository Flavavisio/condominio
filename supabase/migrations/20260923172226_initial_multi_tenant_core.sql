create schema if not exists private;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_url text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  label text not null,
  nif text,
  email text,
  phone text,
  logo_url text,
  brand_color text not null default '#3768f5',
  plan text not null default 'Starter',
  monthly_fee numeric(10,2) not null default 0,
  status text not null default 'active' check (status in ('active','suspended','cancelled')),
  contract_start date,
  contract_end date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin','manager','staff')),
  status text not null default 'active' check (status in ('active','pending','blocked')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.condominiums (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text,
  postal_code text,
  city text,
  fractions_count integer not null default 0 check (fractions_count >= 0),
  status text not null default 'active' check (status in ('active','suspended','archived')),
  contract_ref text,
  monthly_value numeric(10,2) not null default 0,
  settings jsonb not null default '{}'::jsonb,
  building_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fractions (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  code text not null,
  floor text,
  permillage numeric(8,4),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  unique (condominium_id, code)
);

create table public.condominium_members (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  fraction_id uuid references public.fractions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'owner' check (member_role in ('owner','tenant','representative','porter')),
  status text not null default 'active' check (status in ('active','pending','blocked')),
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (condominium_id, user_id, fraction_id)
);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  fraction_id uuid references public.fractions(id) on delete set null,
  reporter_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  place text,
  category text,
  priority text not null default 'normal' check (priority in ('low','normal','urgent')),
  status text not null default 'open' check (status in ('open','analysis','scheduled','progress','resolved','cancelled')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  supporters_count integer not null default 1 check (supporters_count >= 0),
  assigned_to text,
  scheduled_for timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index company_members_user_id_idx on public.company_members(user_id);
create index company_members_company_id_idx on public.company_members(company_id);
create index condominiums_company_id_idx on public.condominiums(company_id);
create index fractions_condominium_id_idx on public.fractions(condominium_id);
create index condominium_members_user_id_idx on public.condominium_members(user_id);
create index condominium_members_condominium_id_idx on public.condominium_members(condominium_id);
create index issues_condominium_id_idx on public.issues(condominium_id);
create index issues_reporter_user_id_idx on public.issues(reporter_user_id);
create index issues_status_idx on public.issues(status);

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles for each row execute function private.touch_updated_at();
create trigger companies_touch_updated_at before update on public.companies for each row execute function private.touch_updated_at();
create trigger condominiums_touch_updated_at before update on public.condominiums for each row execute function private.touch_updated_at();
create trigger issues_touch_updated_at before update on public.issues for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.is_super_admin = true);
$$;

create or replace function private.is_company_member(target_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.company_members cm where cm.company_id = target_company_id and cm.user_id = (select auth.uid()) and cm.status = 'active');
$$;

create or replace function private.is_company_admin(target_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
      or exists (select 1 from public.company_members cm where cm.company_id = target_company_id and cm.user_id = (select auth.uid()) and cm.status = 'active' and cm.role in ('admin','manager'));
$$;

create or replace function private.is_condo_member(target_condominium_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.condominium_members m where m.condominium_id = target_condominium_id and m.user_id = (select auth.uid()) and m.status = 'active');
$$;

create or replace function private.can_view_condo(target_condominium_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
      or private.is_condo_member(target_condominium_id)
      or exists (
        select 1 from public.condominiums c
        join public.company_members cm on cm.company_id = c.company_id
        where c.id = target_condominium_id and cm.user_id = (select auth.uid()) and cm.status = 'active'
      );
$$;

create or replace function private.can_manage_condo(target_condominium_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
      or exists (
        select 1 from public.condominiums c
        join public.company_members cm on cm.company_id = c.company_id
        where c.id = target_condominium_id and cm.user_id = (select auth.uid()) and cm.status = 'active' and cm.role in ('admin','manager','staff')
      );
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;
grant execute on function private.is_condo_member(uuid) to authenticated;
grant execute on function private.can_view_condo(uuid) to authenticated;
grant execute on function private.can_manage_condo(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.condominiums enable row level security;
alter table public.fractions enable row level security;
alter table public.condominium_members enable row level security;
alter table public.issues enable row level security;

grant select, insert, update, delete on public.profiles to authenticated, service_role;
grant select, insert, update, delete on public.companies to authenticated, service_role;
grant select, insert, update, delete on public.company_members to authenticated, service_role;
grant select, insert, update, delete on public.condominiums to authenticated, service_role;
grant select, insert, update, delete on public.fractions to authenticated, service_role;
grant select, insert, update, delete on public.condominium_members to authenticated, service_role;
grant select, insert, update, delete on public.issues to authenticated, service_role;

create policy profiles_select on public.profiles for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_super_admin()));
create policy profiles_update on public.profiles for update to authenticated
using (user_id = (select auth.uid()) or (select private.is_super_admin()))
with check (user_id = (select auth.uid()) or (select private.is_super_admin()));

create policy companies_select on public.companies for select to authenticated
using ((select private.is_super_admin()) or (select private.is_company_member(id)));
create policy companies_insert on public.companies for insert to authenticated with check ((select private.is_super_admin()));
create policy companies_update on public.companies for update to authenticated
using ((select private.is_company_admin(id))) with check ((select private.is_company_admin(id)));
create policy companies_delete on public.companies for delete to authenticated using ((select private.is_super_admin()));

create policy company_members_select on public.company_members for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_company_member(company_id)) or (select private.is_super_admin()));
create policy company_members_insert on public.company_members for insert to authenticated with check ((select private.is_company_admin(company_id)));
create policy company_members_update on public.company_members for update to authenticated
using ((select private.is_company_admin(company_id))) with check ((select private.is_company_admin(company_id)));
create policy company_members_delete on public.company_members for delete to authenticated using ((select private.is_company_admin(company_id)));

create policy condominiums_select on public.condominiums for select to authenticated using ((select private.can_view_condo(id)));
create policy condominiums_insert on public.condominiums for insert to authenticated with check ((select private.is_company_admin(company_id)));
create policy condominiums_update on public.condominiums for update to authenticated
using ((select private.can_manage_condo(id))) with check ((select private.can_manage_condo(id)));
create policy condominiums_delete on public.condominiums for delete to authenticated using ((select private.is_company_admin(company_id)));

create policy fractions_select on public.fractions for select to authenticated using ((select private.can_view_condo(condominium_id)));
create policy fractions_insert on public.fractions for insert to authenticated with check ((select private.can_manage_condo(condominium_id)));
create policy fractions_update on public.fractions for update to authenticated
using ((select private.can_manage_condo(condominium_id))) with check ((select private.can_manage_condo(condominium_id)));
create policy fractions_delete on public.fractions for delete to authenticated using ((select private.can_manage_condo(condominium_id)));

create policy condominium_members_select on public.condominium_members for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_condo(condominium_id)) or (select private.is_super_admin()));
create policy condominium_members_insert on public.condominium_members for insert to authenticated with check ((select private.can_manage_condo(condominium_id)));
create policy condominium_members_update on public.condominium_members for update to authenticated
using ((select private.can_manage_condo(condominium_id))) with check ((select private.can_manage_condo(condominium_id)));
create policy condominium_members_delete on public.condominium_members for delete to authenticated using ((select private.can_manage_condo(condominium_id)));

create policy issues_select on public.issues for select to authenticated
using ((visibility = 'public' and (select private.can_view_condo(condominium_id))) or reporter_user_id = (select auth.uid()) or (select private.can_manage_condo(condominium_id)));
create policy issues_insert on public.issues for insert to authenticated
with check ((select private.can_view_condo(condominium_id)) and (reporter_user_id is null or reporter_user_id = (select auth.uid()) or (select private.can_manage_condo(condominium_id))));
create policy issues_update on public.issues for update to authenticated
using ((select private.can_manage_condo(condominium_id))) with check ((select private.can_manage_condo(condominium_id)));
create policy issues_delete on public.issues for delete to authenticated using ((select private.can_manage_condo(condominium_id)));
