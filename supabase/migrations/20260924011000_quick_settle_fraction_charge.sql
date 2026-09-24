create or replace function public.settle_fraction_charge(
  p_charge_id uuid,
  p_paid_on date default current_date,
  p_method text default 'other'
)
returns table(payment_id uuid, paid_amount numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_charge public.fraction_charges%rowtype;
  v_paid numeric(12,2);
  v_remaining numeric(12,2);
  v_payment_id uuid;
begin
  select * into v_charge
  from public.fraction_charges
  where id = p_charge_id;

  if not found then
    raise exception 'Quota não encontrada.';
  end if;

  if not private.can_manage_condo_finance(v_charge.condominium_id) then
    raise exception 'Sem permissões para liquidar esta quota.' using errcode = '42501';
  end if;

  if v_charge.status = 'cancelled' then
    raise exception 'Uma quota cancelada não pode ser liquidada.';
  end if;

  if p_method not in ('transfer','cash','direct_debit','card','mbway','other') then
    raise exception 'Método de pagamento inválido.';
  end if;

  select coalesce(sum(pa.amount),0)
    into v_paid
  from public.payment_allocations pa
  where pa.charge_id = p_charge_id;

  v_remaining := greatest(v_charge.amount_due - v_paid, 0);

  if v_remaining <= 0 then
    raise exception 'Esta quota já se encontra paga.';
  end if;

  insert into public.fraction_payments(
    condominium_id, fraction_id, paid_on, amount, method, reference, notes, created_by
  ) values (
    v_charge.condominium_id,
    v_charge.fraction_id,
    coalesce(p_paid_on, current_date),
    v_remaining,
    p_method,
    'Liquidação rápida',
    'Pagamento criado através da ação Marcar como pago.',
    auth.uid()
  )
  returning id into v_payment_id;

  insert into public.payment_allocations(payment_id, charge_id, amount)
  values (v_payment_id, p_charge_id, v_remaining);

  return query select v_payment_id, v_remaining;
end;
$$;

revoke all on function public.settle_fraction_charge(uuid,date,text) from public, anon;
grant execute on function public.settle_fraction_charge(uuid,date,text) to authenticated;
