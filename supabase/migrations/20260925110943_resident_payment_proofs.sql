-- A resident administrator has no financial privileges beyond their own fractions.
create or replace function private.can_manage_condo_finance(target_condominium_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select private.can_manage_governance(target_condominium_id);
$$;

create table public.payment_proofs (
 id uuid primary key default gen_random_uuid(),
 condominium_id uuid not null references public.condominiums(id),
 fraction_id uuid not null references public.fractions(id),
 charge_id uuid not null references public.fraction_charges(id),
 submitted_by uuid not null references auth.users(id),
 file_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 255),
 amount numeric(12,2) not null check(amount>0),
 paid_on date not null,
 method text not null default 'transfer' check(method in ('transfer','cash','direct_debit','card','mbway','other')),
 note text not null default '' check(length(note)<=2000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '' check(length(review_note)<=2000),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 payment_id uuid unique references public.fraction_payments(id),
 created_at timestamptz not null default now()
);
create index payment_proofs_condo_status on public.payment_proofs(condominium_id,status,created_at);
create index payment_proofs_fraction on public.payment_proofs(fraction_id);
create index payment_proofs_author on public.payment_proofs(submitted_by);
create index payment_proofs_reviewer on public.payment_proofs(reviewed_by);
create index payment_proofs_charge on public.payment_proofs(charge_id);
create unique index payment_proofs_one_pending on public.payment_proofs(charge_id) where status='pending';
alter table public.payment_proofs enable row level security;
revoke all on public.payment_proofs from anon,authenticated;
grant select,insert,update on public.payment_proofs to authenticated;
create policy proofs_select on public.payment_proofs for select to authenticated using(private.can_view_fraction_finance(fraction_id));
create policy proofs_insert on public.payment_proofs for insert to authenticated with check(
 submitted_by=(select auth.uid()) and status='pending' and exists(select 1 from public.condominium_members m where m.user_id=(select auth.uid()) and m.fraction_id=payment_proofs.fraction_id and m.condominium_id=payment_proofs.condominium_id and m.status='active')
);
create policy proofs_review on public.payment_proofs for update to authenticated using(private.can_manage_condo_finance(condominium_id) and status='pending') with check(private.can_manage_condo_finance(condominium_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-proofs','payment-proofs',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy payment_proofs_upload on storage.objects for insert to authenticated with check(
 bucket_id='payment-proofs' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.condominium_members m where m.user_id=(select auth.uid()) and m.status='active' and m.fraction_id::text=(storage.foldername(name))[2])
);
create policy payment_proofs_read on storage.objects for select to authenticated using(
 bucket_id='payment-proofs' and ((storage.foldername(name))[1]=(select auth.uid())::text
 or exists(select 1 from public.payment_proofs p where p.file_path=name and private.can_view_fraction_finance(p.fraction_id)))
);
-- Only an unsubmitted upload can be removed by its owner; submitted evidence is immutable.
create policy payment_proofs_remove_orphan on storage.objects for delete to authenticated using(
 bucket_id='payment-proofs' and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists(select 1 from public.payment_proofs p where p.file_path=name)
);

create function private.guard_payment_proof() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.fraction_charges; allocated numeric; pid uuid;
begin
 if auth.uid() is null then raise exception 'Sessão necessária.' using errcode='42501'; end if;
 if TG_OP='INSERT' then
   select * into c from public.fraction_charges where id=new.charge_id;
   if not found or c.fraction_id<>new.fraction_id or c.condominium_id<>new.condominium_id then raise exception 'Quota inválida para esta fração.'; end if;
   if not exists(select 1 from public.condominium_members m where m.user_id=auth.uid() and m.fraction_id=c.fraction_id and m.condominium_id=c.condominium_id and m.status='active') then raise exception 'Sem acesso a esta fração.' using errcode='42501'; end if;
   if split_part(new.file_path,'/',1)<>auth.uid()::text or split_part(new.file_path,'/',2)<>new.fraction_id::text
     or not exists(select 1 from storage.objects o where o.bucket_id='payment-proofs' and o.name=new.file_path) then raise exception 'Envie primeiro o comprovativo da sua fração.'; end if;
   select coalesce(sum(amount),0) into allocated from public.payment_allocations where charge_id=c.id;
   if c.status in ('cancelled','paid') or new.amount>c.amount_due-allocated then raise exception 'O valor excede a dívida disponível desta quota.'; end if;
   if new.paid_on>current_date then raise exception 'A data do pagamento não pode ser futura.'; end if;
   new.submitted_by:=auth.uid();new.status:='pending';new.payment_id:=null;new.reviewed_by:=null;new.reviewed_at:=null;new.review_note:='';new.created_at:=now();
 else
   if not private.can_manage_condo_finance(old.condominium_id) then raise exception 'Só a gestora pode validar pagamentos.' using errcode='42501'; end if;
   if old.status<>'pending' or new.status not in ('approved','rejected') then raise exception 'Este comprovativo já foi tratado ou a decisão é inválida.'; end if;
   if (to_jsonb(new)-array['status','review_note']) is distinct from (to_jsonb(old)-array['status','review_note']) then raise exception 'Não pode alterar os dados do comprovativo.'; end if;
   if new.status='rejected' and length(trim(new.review_note))=0 then raise exception 'Indique o motivo da rejeição.'; end if;
   if new.status='approved' then
     select * into c from public.fraction_charges where id=old.charge_id for update;
     select coalesce(sum(amount),0) into allocated from public.payment_allocations where charge_id=c.id;
     if c.status in ('cancelled','paid') or old.amount>c.amount_due-allocated then raise exception 'A dívida mudou. Rejeite este comprovativo e confira os pagamentos já registados.'; end if;
     insert into public.fraction_payments(condominium_id,fraction_id,paid_on,amount,method,reference,notes,created_by)
     values(old.condominium_id,old.fraction_id,old.paid_on,old.amount,old.method,'Comprovativo '||old.id::text,old.note,auth.uid()) returning id into pid;
     insert into public.payment_allocations(payment_id,charge_id,amount) values(pid,old.charge_id,old.amount);
     new.payment_id:=pid;
   end if;
   new.reviewed_by:=auth.uid();new.reviewed_at:=now();
 end if;
 return new;
end;
$$;
revoke all on function private.guard_payment_proof() from public,anon,authenticated;
create trigger payment_proof_guard before insert or update on public.payment_proofs for each row execute function private.guard_payment_proof();

create function public.review_payment_proof(p_proof_id uuid,p_approve boolean,p_note text default '')
returns public.payment_proofs language plpgsql security invoker set search_path='' as $$
declare result public.payment_proofs;
begin
 if auth.uid() is null then raise exception 'Sessão necessária.' using errcode='42501'; end if;
 update public.payment_proofs set status=case when p_approve then 'approved' else 'rejected' end,review_note=coalesce(p_note,'')
 where id=p_proof_id and status='pending' and private.can_manage_condo_finance(condominium_id) returning * into result;
 if not found then raise exception 'Comprovativo já tratado ou sem permissão.'; end if;
 return result;
end;
$$;
revoke all on function public.review_payment_proof(uuid,boolean,text) from public,anon;
grant execute on function public.review_payment_proof(uuid,boolean,text) to authenticated;

-- System notification writes require the internal notification writer, not user RLS.
create function private.payment_proof_alert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new; end if;
 if TG_OP='INSERT' then
   if new.submitted_by<>auth.uid() then raise exception 'Autor inválido.'; end if;
   perform private.queue_condo_notification(new.condominium_id,'proof:'||new.id::text,'payment_proof','Novo comprovativo de pagamento','Existe um comprovativo para validar no Financeiro.','/?condo='||new.condominium_id::text||'&tab=finance','info',jsonb_build_object('proof_id',new.id));
 end if;
 return new;
end;
$$;
revoke all on function private.payment_proof_alert() from public,anon,authenticated;
create trigger payment_proof_alert after insert on public.payment_proofs for each row execute function private.payment_proof_alert();

-- Resident users may only read the modules included in their portal.
do $$ declare t text; begin
 foreach t in array array['documents','suppliers','equipment','maintenance','obligations','obligation_inspections','periodic_services','periodic_service_visits'] loop
 execute format('create policy resident_portal_scope on public.%I as restrictive for select to authenticated using(private.can_manage_condo(condominium_id))',t);
 end loop;
end; $$;
create policy resident_portal_scope on public.obligation_checklist_items as restrictive for select to authenticated using(exists(select 1 from public.obligations o where o.id=obligation_id and private.can_manage_condo(o.condominium_id)));

-- Serialize all allocation paths (manual payments and proof approvals) on the charge.
create function private.guard_payment_allocation() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.fraction_charges; p public.fraction_payments; used_charge numeric; used_payment numeric;
begin
 select * into c from public.fraction_charges where id=new.charge_id for update;
 select * into p from public.fraction_payments where id=new.payment_id for update;
 if c.id is null or p.id is null or c.fraction_id<>p.fraction_id or c.condominium_id<>p.condominium_id then raise exception 'O pagamento e a quota devem pertencer à mesma fração.'; end if;
 if c.status='cancelled' then raise exception 'Quota cancelada.'; end if;
 select coalesce(sum(amount),0) into used_charge from public.payment_allocations where charge_id=c.id and id<>new.id;
 select coalesce(sum(amount),0) into used_payment from public.payment_allocations where payment_id=p.id and id<>new.id;
 if used_charge+new.amount>c.amount_due or used_payment+new.amount>p.amount then raise exception 'Valor já liquidado ou superior ao pagamento disponível. Atualize os dados.'; end if;
 return new;
end;
$$;
revoke all on function private.guard_payment_allocation() from public,anon,authenticated;
create trigger payment_allocation_guard before insert or update on public.payment_allocations for each row execute function private.guard_payment_allocation();
