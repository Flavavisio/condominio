create or replace function public.can_manage_condo_finance(p_condominium_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_condo_finance(p_condominium_id);
$$;

grant execute on function public.can_manage_condo_finance(uuid) to authenticated;

create or replace function public.create_bulk_fraction_charges(
  p_condominium_id uuid,
  p_charge_type text,
  p_period_year integer,
  p_period_month integer,
  p_description text,
  p_due_date date,
  p_mode text,
  p_amount numeric
)
returns table(created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_perm numeric;
  active_count integer;
  created integer := 0;
  skipped integer := 0;
  f record;
  charge_amount numeric(12,2);
begin
  if not private.can_manage_condo_finance(p_condominium_id) then
    raise exception 'Sem permissão para gerir o financeiro deste condomínio.' using errcode = '42501';
  end if;
  if p_charge_type not in ('monthly','annual','extra','reserve_fund','penalty','other') then
    raise exception 'Tipo de quota inválido.';
  end if;
  if p_period_year < 2000 or p_period_year > 2200 then raise exception 'Ano inválido.'; end if;
  if p_period_month < 1 or p_period_month > 12 then raise exception 'Mês inválido.'; end if;
  if p_mode not in ('fixed','permillage') then raise exception 'Modo de cálculo inválido.'; end if;
  if p_amount <= 0 then raise exception 'O valor deve ser superior a zero.'; end if;

  select count(*), coalesce(sum(coalesce(permillage,0)),0)
    into active_count, total_perm
  from public.fractions
  where condominium_id = p_condominium_id and status = 'active';

  if active_count = 0 then raise exception 'O condomínio não tem frações ativas.'; end if;
  if p_mode = 'permillage' and total_perm <= 0 then raise exception 'Não existem permilagens válidas para distribuir o valor.'; end if;

  for f in select id, coalesce(permillage,0) as permillage from public.fractions where condominium_id = p_condominium_id and status = 'active' order by code
  loop
    charge_amount := case when p_mode = 'fixed' then round(p_amount,2) else round(p_amount * f.permillage / total_perm,2) end;
    insert into public.fraction_charges(condominium_id,fraction_id,charge_type,period_year,period_month,description,amount_due,due_date,status,created_by)
    values (p_condominium_id,f.id,p_charge_type,p_period_year,p_period_month,p_description,charge_amount,p_due_date,'open',auth.uid())
    on conflict (fraction_id,charge_type,period_year,period_month,description) do nothing;
    if found then created := created + 1; else skipped := skipped + 1; end if;
  end loop;
  return query select created, skipped;
end;
$$;

grant execute on function public.create_bulk_fraction_charges(uuid,text,integer,integer,text,date,text,numeric) to authenticated;

create or replace function public.register_fraction_payment(
  p_condominium_id uuid,
  p_fraction_id uuid,
  p_paid_on date,
  p_amount numeric,
  p_method text,
  p_reference text default null,
  p_notes text default null,
  p_auto_allocate boolean default true
)
returns table(payment_id uuid, allocated_amount numeric, unallocated_amount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_payment_id uuid;
  remaining numeric(12,2);
  allocated numeric(12,2) := 0;
  c record;
  charge_paid numeric(12,2);
  charge_remaining numeric(12,2);
  use_amount numeric(12,2);
begin
  if not private.can_manage_condo_finance(p_condominium_id) then raise exception 'Sem permissão para registar pagamentos.' using errcode = '42501'; end if;
  if p_amount <= 0 then raise exception 'O valor deve ser superior a zero.'; end if;
  if p_method not in ('transfer','cash','direct_debit','card','mbway','other') then raise exception 'Método de pagamento inválido.'; end if;
  if not exists (select 1 from public.fractions where id = p_fraction_id and condominium_id = p_condominium_id) then raise exception 'A fração não pertence a este condomínio.'; end if;

  insert into public.fraction_payments(condominium_id,fraction_id,paid_on,amount,method,reference,notes,created_by)
  values (p_condominium_id,p_fraction_id,coalesce(p_paid_on,current_date),round(p_amount,2),p_method,nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid())
  returning id into new_payment_id;
  remaining := round(p_amount,2);

  if p_auto_allocate then
    for c in select fc.id, fc.amount_due from public.fraction_charges fc where fc.fraction_id = p_fraction_id and fc.condominium_id = p_condominium_id and fc.status in ('open','partial') order by fc.due_date asc nulls last, fc.period_year asc, fc.period_month asc, fc.created_at asc
    loop
      exit when remaining <= 0;
      select coalesce(sum(pa.amount),0) into charge_paid from public.payment_allocations pa where pa.charge_id = c.id;
      charge_remaining := greatest(c.amount_due - charge_paid,0);
      if charge_remaining <= 0 then continue; end if;
      use_amount := least(remaining,charge_remaining);
      insert into public.payment_allocations(payment_id,charge_id,amount) values (new_payment_id,c.id,use_amount);
      remaining := remaining - use_amount;
      allocated := allocated + use_amount;
    end loop;
  end if;
  return query select new_payment_id, round(allocated,2), round(remaining,2);
end;
$$;

grant execute on function public.register_fraction_payment(uuid,uuid,date,numeric,text,text,text,boolean) to authenticated;
