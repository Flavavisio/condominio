create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  title text not null,
  body text not null default '',
  important boolean not null default false,
  requires_ack boolean not null default false,
  published_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notice_reads (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  read_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (notice_id, user_id)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  name text not null,
  category text not null default 'Outro',
  file_path text,
  visibility text not null default 'all' check (visibility in ('all','admin')),
  document_date date,
  expires_at date,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  name text not null,
  category text not null default 'Outro',
  contact_name text,
  phone text,
  email text,
  sla text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  name text not null,
  category text not null default 'Outro',
  location text,
  brand text,
  model text,
  serial_number text,
  installed_on date,
  next_maintenance_on date,
  status text not null default 'ok' check (status in ('ok','attention','offline','inactive')),
  qr_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominium_id, qr_code)
);

create table if not exists public.maintenance (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  title text not null,
  maintenance_type text not null default 'preventive' check (maintenance_type in ('preventive','corrective','inspection','other')),
  scheduled_for timestamptz,
  completed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','progress','done','cancelled')),
  frequency text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  title text not null,
  category text not null default 'Outro',
  frequency text not null default 'Configurável',
  last_date date,
  next_date date,
  owner_name text not null default 'Administração',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.obligation_checklist_items (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.obligations(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.obligation_inspections (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.obligations(id) on delete cascade,
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  performed_on date not null default current_date,
  result text not null default 'Conforme' check (result in ('Conforme','Com observações','Não conforme')),
  evidence text,
  notes text,
  next_date date,
  performed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_notices_condominium on public.notices(condominium_id, published_at desc);
create index if not exists idx_notice_reads_user on public.notice_reads(user_id, notice_id);
create index if not exists idx_documents_condominium on public.documents(condominium_id, expires_at);
create index if not exists idx_suppliers_condominium on public.suppliers(condominium_id, status);
create index if not exists idx_equipment_condominium on public.equipment(condominium_id, status);
create index if not exists idx_maintenance_condominium on public.maintenance(condominium_id, scheduled_for);
create index if not exists idx_obligations_condominium on public.obligations(condominium_id, next_date);
create index if not exists idx_obligation_checklist_obligation on public.obligation_checklist_items(obligation_id, sort_order);
create index if not exists idx_obligation_inspections_obligation on public.obligation_inspections(obligation_id, performed_on desc);

alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;
alter table public.documents enable row level security;
alter table public.suppliers enable row level security;
alter table public.equipment enable row level security;
alter table public.maintenance enable row level security;
alter table public.obligations enable row level security;
alter table public.obligation_checklist_items enable row level security;
alter table public.obligation_inspections enable row level security;

grant select, insert, update, delete on public.notices to authenticated;
grant select, insert, update, delete on public.notice_reads to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.equipment to authenticated;
grant select, insert, update, delete on public.maintenance to authenticated;
grant select, insert, update, delete on public.obligations to authenticated;
grant select, insert, update, delete on public.obligation_checklist_items to authenticated;
grant select, insert, update, delete on public.obligation_inspections to authenticated;

create policy notices_select on public.notices for select to authenticated using ((select private.can_view_condo(notices.condominium_id)));
create policy notices_insert on public.notices for insert to authenticated with check ((select private.can_manage_condo(notices.condominium_id)));
create policy notices_update on public.notices for update to authenticated using ((select private.can_manage_condo(notices.condominium_id))) with check ((select private.can_manage_condo(notices.condominium_id)));
create policy notices_delete on public.notices for delete to authenticated using ((select private.can_manage_condo(notices.condominium_id)));

create policy notice_reads_select on public.notice_reads for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.notices n where n.id = notice_reads.notice_id and (select private.can_manage_condo(n.condominium_id))
  )
);
create policy notice_reads_insert on public.notice_reads for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.notices n where n.id = notice_reads.notice_id and (select private.can_view_condo(n.condominium_id))
  )
);
create policy notice_reads_update on public.notice_reads for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notice_reads_delete on public.notice_reads for delete to authenticated using (user_id = (select auth.uid()));

create policy documents_select on public.documents for select to authenticated using ((visibility = 'all' and (select private.can_view_condo(documents.condominium_id))) or (select private.can_manage_condo(documents.condominium_id)));
create policy documents_insert on public.documents for insert to authenticated with check ((select private.can_manage_condo(documents.condominium_id)));
create policy documents_update on public.documents for update to authenticated using ((select private.can_manage_condo(documents.condominium_id))) with check ((select private.can_manage_condo(documents.condominium_id)));
create policy documents_delete on public.documents for delete to authenticated using ((select private.can_manage_condo(documents.condominium_id)));

create policy suppliers_select on public.suppliers for select to authenticated using ((select private.can_view_condo(suppliers.condominium_id)));
create policy suppliers_insert on public.suppliers for insert to authenticated with check ((select private.can_manage_condo(suppliers.condominium_id)));
create policy suppliers_update on public.suppliers for update to authenticated using ((select private.can_manage_condo(suppliers.condominium_id))) with check ((select private.can_manage_condo(suppliers.condominium_id)));
create policy suppliers_delete on public.suppliers for delete to authenticated using ((select private.can_manage_condo(suppliers.condominium_id)));

create policy equipment_select on public.equipment for select to authenticated using ((select private.can_view_condo(equipment.condominium_id)));
create policy equipment_insert on public.equipment for insert to authenticated with check ((select private.can_manage_condo(equipment.condominium_id)));
create policy equipment_update on public.equipment for update to authenticated using ((select private.can_manage_condo(equipment.condominium_id))) with check ((select private.can_manage_condo(equipment.condominium_id)));
create policy equipment_delete on public.equipment for delete to authenticated using ((select private.can_manage_condo(equipment.condominium_id)));

create policy maintenance_select on public.maintenance for select to authenticated using ((select private.can_view_condo(maintenance.condominium_id)));
create policy maintenance_insert on public.maintenance for insert to authenticated with check ((select private.can_manage_condo(maintenance.condominium_id)));
create policy maintenance_update on public.maintenance for update to authenticated using ((select private.can_manage_condo(maintenance.condominium_id))) with check ((select private.can_manage_condo(maintenance.condominium_id)));
create policy maintenance_delete on public.maintenance for delete to authenticated using ((select private.can_manage_condo(maintenance.condominium_id)));

create policy obligations_select on public.obligations for select to authenticated using ((select private.can_view_condo(obligations.condominium_id)));
create policy obligations_insert on public.obligations for insert to authenticated with check ((select private.can_manage_condo(obligations.condominium_id)));
create policy obligations_update on public.obligations for update to authenticated using ((select private.can_manage_condo(obligations.condominium_id))) with check ((select private.can_manage_condo(obligations.condominium_id)));
create policy obligations_delete on public.obligations for delete to authenticated using ((select private.can_manage_condo(obligations.condominium_id)));

create policy obligation_checklist_select on public.obligation_checklist_items for select to authenticated using (exists (
  select 1 from public.obligations o where o.id = obligation_checklist_items.obligation_id and (select private.can_view_condo(o.condominium_id))
));
create policy obligation_checklist_insert on public.obligation_checklist_items for insert to authenticated with check (exists (
  select 1 from public.obligations o where o.id = obligation_checklist_items.obligation_id and (select private.can_manage_condo(o.condominium_id))
));
create policy obligation_checklist_update on public.obligation_checklist_items for update to authenticated using (exists (
  select 1 from public.obligations o where o.id = obligation_checklist_items.obligation_id and (select private.can_manage_condo(o.condominium_id))
)) with check (exists (
  select 1 from public.obligations o where o.id = obligation_checklist_items.obligation_id and (select private.can_manage_condo(o.condominium_id))
));
create policy obligation_checklist_delete on public.obligation_checklist_items for delete to authenticated using (exists (
  select 1 from public.obligations o where o.id = obligation_checklist_items.obligation_id and (select private.can_manage_condo(o.condominium_id))
));

create policy obligation_inspections_select on public.obligation_inspections for select to authenticated using ((select private.can_view_condo(obligation_inspections.condominium_id)));
create policy obligation_inspections_insert on public.obligation_inspections for insert to authenticated with check ((select private.can_manage_condo(obligation_inspections.condominium_id)));
create policy obligation_inspections_update on public.obligation_inspections for update to authenticated using ((select private.can_manage_condo(obligation_inspections.condominium_id))) with check ((select private.can_manage_condo(obligation_inspections.condominium_id)));
create policy obligation_inspections_delete on public.obligation_inspections for delete to authenticated using ((select private.can_manage_condo(obligation_inspections.condominium_id)));

create trigger notices_touch_updated_at before update on public.notices for each row execute function private.touch_updated_at();
create trigger documents_touch_updated_at before update on public.documents for each row execute function private.touch_updated_at();
create trigger suppliers_touch_updated_at before update on public.suppliers for each row execute function private.touch_updated_at();
create trigger equipment_touch_updated_at before update on public.equipment for each row execute function private.touch_updated_at();
create trigger maintenance_touch_updated_at before update on public.maintenance for each row execute function private.touch_updated_at();
create trigger obligations_touch_updated_at before update on public.obligations for each row execute function private.touch_updated_at();
