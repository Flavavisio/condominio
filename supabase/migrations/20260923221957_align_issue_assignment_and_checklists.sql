alter table public.issues
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists equipment_id uuid references public.equipment(id) on delete set null,
  add column if not exists maintenance_id uuid references public.maintenance(id) on delete set null;

create index if not exists issues_supplier_id_idx on public.issues(supplier_id);
create index if not exists issues_equipment_id_idx on public.issues(equipment_id);

alter table public.obligation_checklist_items
  add column if not exists done boolean not null default false;
