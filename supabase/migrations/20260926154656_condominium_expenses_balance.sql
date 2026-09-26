-- Financial costs are separate from resident-visible operational service records.
create table public.service_contracts (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id),
 periodic_service_id uuid references public.periodic_services(id), supplier_id uuid references public.suppliers(id),
 title text not null check(length(trim(title))>0), category text not null default 'Outro',
 amount numeric(12,2) not null check(amount>0), interval_months integer not null check(interval_months in(1,2,3,6,12)),
 starts_on date not null, ends_on date, next_due_on date not null, active boolean not null default true,
 created_at timestamptz not null default now(), check(ends_on is null or ends_on>=starts_on), check(next_due_on>=starts_on)
);
create table public.condominium_expenses (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id),
 contract_id uuid references public.service_contracts(id), supplier_id uuid references public.suppliers(id),
 description text not null check(length(trim(description))>0), category text not null default 'Outro',
 amount numeric(12,2) not null check(amount>0), due_on date not null, invoice_ref text,
 status text not null default 'pending' check(status in('pending','paid','cancelled')), paid_on date,
 notes text, created_at timestamptz not null default now(),
 check((status='paid' and paid_on is not null) or (status<>'paid' and paid_on is null)),
 unique(contract_id,due_on)
);
create table public.condominium_balance_settings (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null unique references public.condominiums(id),
 opening_on date not null, opening_amount numeric(12,2) not null default 0, updated_at timestamptz not null default now()
);
create index on public.service_contracts(condominium_id);
create index on public.service_contracts(periodic_service_id);
create index on public.service_contracts(supplier_id);
create index on public.condominium_expenses(condominium_id,due_on);
create index on public.condominium_expenses(supplier_id);
alter table public.service_contracts enable row level security;
alter table public.condominium_expenses enable row level security;
alter table public.condominium_balance_settings enable row level security;
grant select,insert,update on public.service_contracts,public.condominium_expenses,public.condominium_balance_settings to authenticated;
create policy contracts_manage on public.service_contracts for all to authenticated using((select private.can_manage_condo_finance(condominium_id))) with check((select private.can_manage_condo_finance(condominium_id)));
create policy expenses_manage on public.condominium_expenses for all to authenticated using((select private.can_manage_condo_finance(condominium_id))) with check((select private.can_manage_condo_finance(condominium_id)));
create policy balances_manage on public.condominium_balance_settings for all to authenticated using((select private.can_manage_condo_finance(condominium_id))) with check((select private.can_manage_condo_finance(condominium_id)));

create function private.guard_condominium_costs() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.condominium_id<>old.condominium_id then raise exception 'Não pode transferir um registo financeiro para outro condomínio.';end if;
 if TG_TABLE_NAME='service_contracts' then
  if TG_OP='UPDATE' and (new.starts_on<>old.starts_on or new.interval_months<>old.interval_months or new.periodic_service_id is distinct from old.periodic_service_id) then raise exception 'Para alterar a periodicidade ou início, termine este contrato e crie outro.';end if;
  if new.periodic_service_id is not null and not exists(select 1 from public.periodic_services where id=new.periodic_service_id and condominium_id=new.condominium_id) then raise exception 'Serviço de outro condomínio.';end if;
 else
  if new.contract_id is not null and not exists(select 1 from public.service_contracts where id=new.contract_id and condominium_id=new.condominium_id) then raise exception 'Contrato de outro condomínio.';end if;
  if TG_OP='UPDATE' and (old.contract_id is distinct from new.contract_id or (old.contract_id is not null and old.due_on<>new.due_on)) then raise exception 'Não pode alterar a origem de uma despesa recorrente.';end if;
  if TG_OP='UPDATE' and old.status='paid' and (new.amount<>old.amount or new.status<>old.status or new.paid_on is distinct from old.paid_on) then raise exception 'Pagamento já registado. Não pode alterar ou anular o movimento pago.';end if;
  if new.paid_on>current_date then raise exception 'A data do pagamento não pode ser futura.';end if;
 end if;
 if new.supplier_id is not null and not exists(select 1 from public.suppliers where id=new.supplier_id and condominium_id=new.condominium_id) then raise exception 'Fornecedor de outro condomínio.';end if;
 return new;
end $$;
revoke all on function private.guard_condominium_costs() from public,anon,authenticated;
create trigger contract_scope_guard before insert or update on public.service_contracts for each row execute function private.guard_condominium_costs();
create trigger expense_scope_guard before insert or update on public.condominium_expenses for each row execute function private.guard_condominium_costs();

create function public.generate_service_expenses(p_condominium_id uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare r public.service_contracts; d date; n integer; added integer:=0; affected integer;
begin
 if not private.can_manage_condo_finance(p_condominium_id) then raise exception 'Sem permissões.' using errcode='42501';end if;
 for r in select * from public.service_contracts where condominium_id=p_condominium_id and active and next_due_on<=current_date order by id for update loop
  d:=r.next_due_on;
  while d<=current_date and (r.ends_on is null or d<=r.ends_on) loop
   insert into public.condominium_expenses(condominium_id,contract_id,supplier_id,description,category,amount,due_on)
   values(r.condominium_id,r.id,r.supplier_id,r.title,r.category,r.amount,d) on conflict(contract_id,due_on) do nothing;
   get diagnostics affected=row_count;added:=added+affected;
   n:=((extract(year from d)::integer-extract(year from r.starts_on)::integer)*12+extract(month from d)::integer-extract(month from r.starts_on)::integer)/r.interval_months+1;
   d:=(r.starts_on+pg_catalog.make_interval(months=>n*r.interval_months))::date;
  end loop;
  update public.service_contracts set next_due_on=d where id=r.id;
 end loop;
 return added;
end $$;
revoke all on function public.generate_service_expenses(uuid) from public,anon;
grant execute on function public.generate_service_expenses(uuid) to authenticated;
