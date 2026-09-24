create table if not exists public.fraction_charges (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  fraction_id uuid not null references public.fractions(id) on delete cascade,
  charge_type text not null default 'monthly' check (charge_type in ('monthly','annual','extra','reserve_fund','penalty','other')),
  period_year integer not null check (period_year between 2000 and 2200),
  period_month integer null check (period_month between 1 and 12),
  description text not null,
  amount_due numeric(12,2) not null check (amount_due >= 0),
  due_date date not null,
  status text not null default 'open' check (status in ('open','partial','paid','cancelled')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fraction_id, charge_type, period_year, period_month, description)
);

create table if not exists public.fraction_payments (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums(id) on delete cascade,
  fraction_id uuid not null references public.fractions(id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'transfer' check (method in ('transfer','cash','direct_debit','card','mbway','other')),
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.fraction_payments(id) on delete cascade,
  charge_id uuid not null references public.fraction_charges(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, charge_id)
);

create index if not exists idx_fraction_charges_condominium on public.fraction_charges(condominium_id);
create index if not exists idx_fraction_charges_fraction on public.fraction_charges(fraction_id);
create index if not exists idx_fraction_charges_due_date on public.fraction_charges(due_date);
create index if not exists idx_fraction_charges_period on public.fraction_charges(period_year, period_month);
create index if not exists idx_fraction_payments_condominium on public.fraction_payments(condominium_id);
create index if not exists idx_fraction_payments_fraction on public.fraction_payments(fraction_id);
create index if not exists idx_fraction_payments_paid_on on public.fraction_payments(paid_on);
create index if not exists idx_payment_allocations_payment on public.payment_allocations(payment_id);
create index if not exists idx_payment_allocations_charge on public.payment_allocations(charge_id);

create or replace function private.can_manage_condo_finance(target_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_condo(target_condominium_id)
      or exists (
        select 1
        from public.condominium_members cm
        where cm.condominium_id = target_condominium_id
          and cm.user_id = (select auth.uid())
          and cm.status = 'active'
          and coalesce(cm.is_condominium_admin,false) = true
      );
$$;

create or replace function private.can_view_fraction_finance(target_fraction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fractions f
    where f.id = target_fraction_id
      and (
        private.can_manage_condo_finance(f.condominium_id)
        or exists (
          select 1 from public.condominium_members cm
          where cm.fraction_id = f.id
            and cm.user_id = (select auth.uid())
            and cm.status = 'active'
        )
      )
  );
$$;

create or replace function public.refresh_charge_status(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_amount numeric(12,2);
  paid_amount numeric(12,2);
begin
  select amount_due into due_amount from public.fraction_charges where id = p_charge_id;
  if due_amount is null then return; end if;
  select coalesce(sum(amount),0) into paid_amount from public.payment_allocations where charge_id = p_charge_id;
  update public.fraction_charges
  set status = case
    when status = 'cancelled' then 'cancelled'
    when paid_amount <= 0 then 'open'
    when paid_amount < due_amount then 'partial'
    else 'paid'
  end,
  updated_at = now()
  where id = p_charge_id;
end;
$$;

create or replace function public.payment_allocation_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.refresh_charge_status(old.charge_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.refresh_charge_status(new.charge_id); end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_payment_allocation_refresh on public.payment_allocations;
create trigger trg_payment_allocation_refresh
after insert or update or delete on public.payment_allocations
for each row execute function public.payment_allocation_refresh_trigger();

alter table public.fraction_charges enable row level security;
alter table public.fraction_payments enable row level security;
alter table public.payment_allocations enable row level security;

revoke all on public.fraction_charges, public.fraction_payments, public.payment_allocations from anon;
grant select,insert,update,delete on public.fraction_charges, public.fraction_payments, public.payment_allocations to authenticated;

drop policy if exists fraction_charges_select on public.fraction_charges;
create policy fraction_charges_select on public.fraction_charges for select to authenticated
using (private.can_view_fraction_finance(fraction_id));
drop policy if exists fraction_charges_insert on public.fraction_charges;
create policy fraction_charges_insert on public.fraction_charges for insert to authenticated
with check (private.can_manage_condo_finance(condominium_id));
drop policy if exists fraction_charges_update on public.fraction_charges;
create policy fraction_charges_update on public.fraction_charges for update to authenticated
using (private.can_manage_condo_finance(condominium_id))
with check (private.can_manage_condo_finance(condominium_id));
drop policy if exists fraction_charges_delete on public.fraction_charges;
create policy fraction_charges_delete on public.fraction_charges for delete to authenticated
using (private.can_manage_condo_finance(condominium_id));

drop policy if exists fraction_payments_select on public.fraction_payments;
create policy fraction_payments_select on public.fraction_payments for select to authenticated
using (private.can_view_fraction_finance(fraction_id));
drop policy if exists fraction_payments_insert on public.fraction_payments;
create policy fraction_payments_insert on public.fraction_payments for insert to authenticated
with check (private.can_manage_condo_finance(condominium_id));
drop policy if exists fraction_payments_update on public.fraction_payments;
create policy fraction_payments_update on public.fraction_payments for update to authenticated
using (private.can_manage_condo_finance(condominium_id))
with check (private.can_manage_condo_finance(condominium_id));
drop policy if exists fraction_payments_delete on public.fraction_payments;
create policy fraction_payments_delete on public.fraction_payments for delete to authenticated
using (private.can_manage_condo_finance(condominium_id));

drop policy if exists payment_allocations_select on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations for select to authenticated
using (exists (select 1 from public.fraction_payments p where p.id = payment_id and private.can_view_fraction_finance(p.fraction_id)));
drop policy if exists payment_allocations_insert on public.payment_allocations;
create policy payment_allocations_insert on public.payment_allocations for insert to authenticated
with check (exists (select 1 from public.fraction_payments p where p.id = payment_id and private.can_manage_condo_finance(p.condominium_id)));
drop policy if exists payment_allocations_update on public.payment_allocations;
create policy payment_allocations_update on public.payment_allocations for update to authenticated
using (exists (select 1 from public.fraction_payments p where p.id = payment_id and private.can_manage_condo_finance(p.condominium_id)))
with check (exists (select 1 from public.fraction_payments p where p.id = payment_id and private.can_manage_condo_finance(p.condominium_id)));
drop policy if exists payment_allocations_delete on public.payment_allocations;
create policy payment_allocations_delete on public.payment_allocations for delete to authenticated
using (exists (select 1 from public.fraction_payments p where p.id = payment_id and private.can_manage_condo_finance(p.condominium_id)));
