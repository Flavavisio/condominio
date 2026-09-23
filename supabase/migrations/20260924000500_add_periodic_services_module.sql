create table if not exists public.periodic_services (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  title text not null,
  service_type text not null default 'Limpeza',
  area text,
  frequency text not null default 'Semanal',
  weekday text,
  time_of_day time,
  last_service_on date,
  next_service_on date,
  estimated_minutes integer,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.periodic_service_visits (
  id uuid primary key default gen_random_uuid(),
  periodic_service_id uuid not null references public.periodic_services(id) on delete cascade,
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  performed_on timestamptz not null default now(),
  performed_by text,
  result text not null default 'done' check (result in ('done','partial','missed','issue')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_periodic_services_condominium on public.periodic_services(condominium_id);
create index if not exists idx_periodic_services_supplier on public.periodic_services(supplier_id);
create index if not exists idx_periodic_services_next on public.periodic_services(next_service_on);
create index if not exists idx_periodic_service_visits_service on public.periodic_service_visits(periodic_service_id);
create index if not exists idx_periodic_service_visits_condominium on public.periodic_service_visits(condominium_id);

alter table public.periodic_services enable row level security;
alter table public.periodic_service_visits enable row level security;

drop policy if exists periodic_services_select on public.periodic_services;
create policy periodic_services_select on public.periodic_services for select using ((select private.can_view_condo(periodic_services.condominium_id)));
drop policy if exists periodic_services_insert on public.periodic_services;
create policy periodic_services_insert on public.periodic_services for insert with check ((select private.can_manage_condo(periodic_services.condominium_id)));
drop policy if exists periodic_services_update on public.periodic_services;
create policy periodic_services_update on public.periodic_services for update using ((select private.can_manage_condo(periodic_services.condominium_id))) with check ((select private.can_manage_condo(periodic_services.condominium_id)));
drop policy if exists periodic_services_delete on public.periodic_services;
create policy periodic_services_delete on public.periodic_services for delete using ((select private.can_manage_condo(periodic_services.condominium_id)));

drop policy if exists periodic_service_visits_select on public.periodic_service_visits;
create policy periodic_service_visits_select on public.periodic_service_visits for select using ((select private.can_view_condo(periodic_service_visits.condominium_id)));
drop policy if exists periodic_service_visits_insert on public.periodic_service_visits;
create policy periodic_service_visits_insert on public.periodic_service_visits for insert with check ((select private.can_manage_condo(periodic_service_visits.condominium_id)));
drop policy if exists periodic_service_visits_update on public.periodic_service_visits;
create policy periodic_service_visits_update on public.periodic_service_visits for update using ((select private.can_manage_condo(periodic_service_visits.condominium_id))) with check ((select private.can_manage_condo(periodic_service_visits.condominium_id)));
drop policy if exists periodic_service_visits_delete on public.periodic_service_visits;
create policy periodic_service_visits_delete on public.periodic_service_visits for delete using ((select private.can_manage_condo(periodic_service_visits.condominium_id)));

grant select,insert,update,delete on public.periodic_services to authenticated;
grant select,insert,update,delete on public.periodic_service_visits to authenticated;