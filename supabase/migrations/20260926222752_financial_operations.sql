-- Financial operations remain visible only to the managing company.
create table public.condominium_budgets (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id) on delete cascade,
 year integer not null check(year between 2000 and 2200), category text not null check(length(trim(category)) between 1 and 100),
 amount numeric(12,2) not null check(amount>=0), unique(condominium_id,year,category)
);
create table public.expense_documents (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id) on delete cascade,
 expense_id uuid not null references public.condominium_expenses(id) on delete cascade,
 file_path text not null unique, file_name text not null, created_at timestamptz not null default now()
);
create index expense_documents_expense on public.expense_documents(expense_id);
create index expense_documents_condo on public.expense_documents(condominium_id);
create table public.bank_movements (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id) on delete cascade,
 account text not null check(length(trim(account)) between 1 and 100), booked_on date not null,
 amount numeric(12,2) not null check(amount<>0), description text not null default '', sender text not null default '', reference text not null default '',
 occurrence integer not null default 1 check(occurrence between 1 and 10000), fingerprint text not null,
 status text not null default 'pending' check(status in('pending','reconciled','ignored')),
 fraction_id uuid references public.fractions(id), payment_id uuid unique references public.fraction_payments(id),
 expense_id uuid unique references public.condominium_expenses(id), note text not null default '',
 history jsonb not null default '[]', created_at timestamptz not null default now(),
 unique(condominium_id,account,fingerprint)
);
create index bank_movements_condo_date on public.bank_movements(condominium_id,booked_on);
create index bank_movements_fraction on public.bank_movements(fraction_id);
do $$ declare t text;begin
 foreach t in array array['condominium_budgets','expense_documents','bank_movements'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
 execute format('create policy managed_finance on public.%I for all to authenticated using(private.can_manage_condo_finance(condominium_id)) with check(private.can_manage_condo_finance(condominium_id))',t);
 end loop;
end $$;
create function private.guard_finance_documents() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.condominium_id<>old.condominium_id then raise exception 'Não pode mover dados entre condomínios.';end if;
 if TG_TABLE_NAME='expense_documents' then
 if not exists(select 1 from public.condominium_expenses e where e.id=new.expense_id and e.condominium_id=new.condominium_id) or split_part(new.file_path,'/',1)<>new.condominium_id::text or split_part(new.file_path,'/',2)<>new.expense_id::text then raise exception 'Fatura ou despesa inválida.';end if;
 end if;return new;
end $$;
revoke all on function private.guard_finance_documents() from public,anon,authenticated;
create trigger budget_guard before update on public.condominium_budgets for each row execute function private.guard_finance_documents();
create trigger expense_document_guard before insert or update on public.expense_documents for each row execute function private.guard_finance_documents();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('expense-invoices','expense-invoices',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy invoice_read on storage.objects for select to authenticated using(bucket_id='expense-invoices' and exists(select 1 from public.condominium_expenses e where e.condominium_id::text=(storage.foldername(storage.objects.name))[1] and e.id::text=(storage.foldername(storage.objects.name))[2]));
create policy invoice_upload on storage.objects for insert to authenticated with check(bucket_id='expense-invoices' and exists(select 1 from public.condominium_expenses e where e.condominium_id::text=(storage.foldername(storage.objects.name))[1] and e.id::text=(storage.foldername(storage.objects.name))[2]));
create policy invoice_cleanup on storage.objects for delete to authenticated using(bucket_id='expense-invoices' and exists(select 1 from public.condominium_expenses e where e.condominium_id::text=(storage.foldername(storage.objects.name))[1] and e.id::text=(storage.foldername(storage.objects.name))[2]));
create function private.guard_bank_movement() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.fraction_payments; e public.condominium_expenses; pid uuid;
begin
 if not private.can_manage_condo_finance(new.condominium_id) then raise exception 'Sem permissão.' using errcode='42501';end if;
 if TG_OP='INSERT' then
 new.account:=lower(trim(new.account));new.description:=trim(new.description);new.sender:=trim(new.sender);new.reference:=trim(new.reference);
 new.fingerprint:=md5(jsonb_build_array(new.booked_on,new.amount,lower(new.description),lower(new.sender),lower(new.reference),new.occurrence)::text);
 new.status:='pending';new.fraction_id:=null;new.payment_id:=null;new.expense_id:=null;new.history:='[]';return new;
 end if;
 if (new.condominium_id,new.account,new.booked_on,new.amount,new.description,new.sender,new.reference,new.occurrence,new.fingerprint) is distinct from (old.condominium_id,old.account,old.booked_on,old.amount,old.description,old.sender,old.reference,old.occurrence,old.fingerprint) then raise exception 'Os dados importados são imutáveis. Ignore o movimento incorreto.';end if;
 new.history:=old.history;
 if old.status='reconciled' and new.status='reconciled' and (new.payment_id,new.expense_id,new.fraction_id) is distinct from (old.payment_id,old.expense_id,old.fraction_id) then raise exception 'Desassocie primeiro o movimento.';end if;
 if new.status='reconciled' and old.status<>'reconciled' then
 if new.booked_on>current_date then raise exception 'Não pode conciliar movimentos futuros.';end if;
 if new.amount>0 then
 new.expense_id:=null;
 if new.payment_id is not null then
 select * into p from public.fraction_payments where id=new.payment_id for update;
 if p.id is null or p.condominium_id<>new.condominium_id or p.amount<>new.amount then raise exception 'Pagamento existente incompatível com o movimento.';end if;
 new.fraction_id:=p.fraction_id;
 else
 if not exists(select 1 from public.fractions where id=new.fraction_id and condominium_id=new.condominium_id) then raise exception 'Selecione uma fração deste condomínio.';end if;
 -- Lock the fraction so two imports cannot create the same payment concurrently.
 perform 1 from public.fractions where id=new.fraction_id for update;
 if exists(select 1 from public.fraction_payments where fraction_id=new.fraction_id and amount=new.amount and abs(paid_on-new.booked_on)<=3) then raise exception 'Possível pagamento duplicado. Associe o pagamento já existente.';end if;
 if exists(select 1 from public.payment_proofs where fraction_id=new.fraction_id and status='pending' and amount=new.amount and abs(paid_on-new.booked_on)<=3) then raise exception 'Existe um comprovativo por validar. Valide-o e associe o pagamento existente.';end if;
 select payment_id into pid from public.register_fraction_payment(new.condominium_id,new.fraction_id,new.booked_on,new.amount,'transfer',nullif(new.reference,''),'Extrato: '||new.description,true);
 new.payment_id:=pid;
 end if;
 else
 new.payment_id:=null;new.fraction_id:=null;
 select * into e from public.condominium_expenses where id=new.expense_id for update;
 if e.id is null or e.condominium_id<>new.condominium_id or e.amount<>abs(new.amount) or e.status='cancelled' then raise exception 'Selecione uma despesa com o mesmo valor.';end if;
 if e.status='pending' then update public.condominium_expenses set status='paid',paid_on=new.booked_on where id=e.id;end if;
 end if;
 elsif new.status<>'reconciled' then
 if old.status='reconciled' and length(trim(new.note))<3 then raise exception 'Indique o motivo da desassociação. O pagamento mantém-se registado.';end if;
 new.payment_id:=null;new.expense_id:=null;new.fraction_id:=null;
 end if;
 if (new.status,new.payment_id,new.expense_id,new.note) is distinct from (old.status,old.payment_id,old.expense_id,old.note) then
 new.history:=old.history||jsonb_build_array(jsonb_build_object('at',now(),'by',auth.uid(),'from',old.status,'to',new.status,'payment_id',coalesce(new.payment_id,old.payment_id),'expense_id',coalesce(new.expense_id,old.expense_id),'note',new.note));end if;
 return new;
end $$;
revoke all on function private.guard_bank_movement() from public,anon,authenticated;
create trigger bank_movement_guard before insert or update on public.bank_movements for each row execute function private.guard_bank_movement();
create function public.reconcile_bank_movements(p_items jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb;n integer:=0;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 then raise exception 'Selecione até 200 movimentos.';end if;
 for item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
 update public.bank_movements set status='reconciled',fraction_id=nullif(item->>'fraction_id','')::uuid,payment_id=nullif(item->>'payment_id','')::uuid,expense_id=nullif(item->>'expense_id','')::uuid where id=(item->>'id')::uuid and status='pending';
 if not found then raise exception 'Movimento indisponível ou já tratado. Atualize a lista.';end if;n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.reconcile_bank_movements(jsonb) from public,anon;
grant execute on function public.reconcile_bank_movements(jsonb) to authenticated;
