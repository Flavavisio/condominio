create table public.recurring_dues (
 condominium_id uuid primary key references public.condominiums(id) on delete cascade,
 enabled boolean not null default false,
 description text not null default 'Quota mensal' check(length(description) between 1 and 160),
 amount numeric(12,2) not null check(amount>0),
 mode text not null default 'fixed' check(mode in('fixed','permillage')),
 due_day integer not null default 8 check(due_day between 1 and 28),
 starts_month date not null check(extract(day from starts_month)=1),
 ends_month date check(ends_month is null or (extract(day from ends_month)=1 and ends_month>=starts_month)),
 reminders boolean not null default false,
 last_run_at timestamptz,last_error text,updated_at timestamptz not null default now()
);
alter table public.recurring_dues enable row level security;
revoke all on public.recurring_dues from anon,authenticated;
grant select on public.recurring_dues to authenticated;
grant insert(condominium_id,enabled,description,amount,mode,due_day,starts_month,ends_month,reminders),update(enabled,description,amount,mode,due_day,starts_month,ends_month,reminders) on public.recurring_dues to authenticated;
grant all on public.recurring_dues to service_role;
create policy recurring_dues_select on public.recurring_dues for select to authenticated using(public.can_manage_condo_finance(condominium_id));
create policy recurring_dues_insert on public.recurring_dues for insert to authenticated with check(public.can_manage_condo_finance(condominium_id));
create policy recurring_dues_update on public.recurring_dues for update to authenticated using(public.can_manage_condo_finance(condominium_id)) with check(public.can_manage_condo_finance(condominium_id));
create function private.validate_recurring_dues() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' or new.starts_month<>old.starts_month) and new.starts_month<date_trunc('month',now() at time zone 'Europe/Lisbon')::date then raise exception 'Escolha o mês atual ou um mês futuro. Não são criadas quotas retroativas na configuração.';end if;
 if extract(year from new.starts_month)>2200 or extract(year from new.ends_month)>2200 then raise exception 'Ano inválido';end if;
 new.updated_at=now();return new;
end $$;
revoke all on function private.validate_recurring_dues() from public,anon,authenticated;
create trigger recurring_dues_validation before insert or update on public.recurring_dues for each row execute function private.validate_recurring_dues();
create table public.recurring_due_runs (
 condominium_id uuid not null references public.condominiums(id) on delete cascade,
 fraction_id uuid not null references public.fractions(id) on delete cascade,
 period date not null,charge_id uuid references public.fraction_charges(id) on delete set null,
 created_at timestamptz not null default now(),primary key(fraction_id,period)
);
create index recurring_due_runs_condo on public.recurring_due_runs(condominium_id);
create index recurring_due_runs_charge on public.recurring_due_runs(charge_id);
alter table public.recurring_due_runs enable row level security;
revoke all on public.recurring_due_runs from public,anon,authenticated;
grant all on public.recurring_due_runs to service_role;
create function public.process_recurring_dues() returns integer language plpgsql security invoker set search_path='' as $$
declare r record; f record; period_start date; charge uuid; count_created integer:=0; count_before integer; today date:=(now() at time zone 'Europe/Lisbon')::date;
begin
 perform pg_catalog.pg_advisory_xact_lock(28214159);
 for r in select d.*,c.company_id from public.recurring_dues d join public.condominiums c on c.id=d.condominium_id join public.companies co on co.id=c.company_id
 where d.enabled and c.status='active' and co.status='active' and exists(select 1 from public.company_admin_licenses l where l.company_id=co.id and l.status='active' and l.starts_on<=today and l.expires_on>=today)
 loop
  count_before=count_created;
  begin
   if not exists(select 1 from public.fractions where condominium_id=r.condominium_id and status='active') then raise exception 'Sem frações ativas.';end if;
   if r.mode='permillage' and exists(select 1 from public.fractions where condominium_id=r.condominium_id and status='active' and coalesce(permillage,0)<=0) then raise exception 'Preencha uma permilagem positiva em todas as frações ativas.';end if;
   -- Current month plus missed runs; no work before the rule's explicit starting month.
   for period_start in select g::date from generate_series(greatest(r.starts_month,date_trunc('month',today)-interval '24 months'),least(coalesce(r.ends_month,today),today),interval '1 month') g
   loop
    for f in with base as (
     select id,case when r.mode='fixed' then r.amount*100 else r.amount*100*permillage/sum(permillage) over() end as cents
     from public.fractions where condominium_id=r.condominium_id and status='active'
    ),split as (select *,floor(cents) as whole,row_number() over(order by cents-floor(cents) desc,id) as position,sum(floor(cents)) over() as total_whole from base)
    select id,(case when r.mode='fixed' then cents else whole+case when position<=round(r.amount*100)-total_whole then 1 else 0 end end)/100 as amount from split
    loop
     if exists(select 1 from public.recurring_due_runs where fraction_id=f.id and period=period_start) then continue;end if;
     -- Existing monthly charges, even cancelled ones, require manual review instead of duplication.
     select id into charge from public.fraction_charges where fraction_id=f.id and charge_type='monthly' and period_year=extract(year from period_start) and period_month=extract(month from period_start) limit 1;
     if not found and f.amount>0 then
      insert into public.fraction_charges(condominium_id,fraction_id,charge_type,period_year,period_month,description,amount_due,due_date,notes)
      values(r.condominium_id,f.id,'monthly',extract(year from period_start),extract(month from period_start),r.description,f.amount,period_start+r.due_day-1,'Criada pela regra de quotas automáticas.') returning id into charge;
      count_created=count_created+1;
      insert into public.notifications(user_id,company_id,condominium_id,event_key,kind,title,body,payload)
      select distinct m.user_id,r.company_id,r.condominium_id,'charge-issued:'||charge,'charge_issued','Nova quota disponível',r.description||' · '||to_char(period_start,'MM/YYYY')||'. Consulte o Financeiro da sua fração para ver o valor e enviar o comprovativo.',jsonb_build_object('charge_id',charge)
      from public.condominium_members m where m.fraction_id=f.id and m.condominium_id=r.condominium_id and m.status='active' on conflict(user_id,event_key) do nothing;
     end if;
     insert into public.recurring_due_runs(condominium_id,fraction_id,period,charge_id) values(r.condominium_id,f.id,period_start,charge) on conflict do nothing;
    end loop;
   end loop;
   update public.recurring_dues set last_run_at=now(),last_error=null where condominium_id=r.condominium_id;
  exception when others then
   count_created=count_before;
   update public.recurring_dues set last_run_at=now(),last_error=sqlerrm where condominium_id=r.condominium_id;
  end;
 end loop;
 -- One reminder per recipient/charge/week, only after seven days overdue and while a balance remains.
 insert into public.notifications(user_id,company_id,condominium_id,event_key,kind,severity,title,body,payload)
 select distinct m.user_id,c.company_id,q.condominium_id,'charge-reminder:'||q.id||':'||((today-q.due_date)/7),'charge_reminder','warning','Quota por regularizar',q.description||' · '||lpad(q.period_month::text,2,'0')||'/'||q.period_year||'. Consulte o saldo atualizado no Financeiro da sua fração. Se já pagou, envie o comprovativo.',jsonb_build_object('charge_id',q.id)
 from public.fraction_charges q join public.recurring_dues d on d.condominium_id=q.condominium_id and d.enabled and d.reminders
 join public.condominiums c on c.id=q.condominium_id join public.companies co on co.id=c.company_id and co.status='active'
 join public.condominium_members m on m.fraction_id=q.fraction_id and m.condominium_id=q.condominium_id and m.status='active'
 where c.status='active' and q.charge_type='monthly' and q.status in('open','partial') and q.due_date<=today-7 and q.amount_due>coalesce((select sum(a.amount) from public.payment_allocations a where a.charge_id=q.id),0)
 and not exists(select 1 from public.payment_proofs p where p.charge_id=q.id and p.status='pending')
 and exists(select 1 from public.company_admin_licenses l where l.company_id=c.company_id and l.status='active' and l.starts_on<=today and l.expires_on>=today)
 on conflict(user_id,event_key) do nothing;
 return count_created;
end $$;
revoke all on function public.process_recurring_dues() from public,anon,authenticated;
grant execute on function public.process_recurring_dues() to service_role;
select cron.schedule('condomia-recurring-dues','10 8 * * *','select public.process_recurring_dues()');
