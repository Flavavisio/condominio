begin;
do $$
declare manager uuid:=gen_random_uuid(); resident uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); co uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); contract uuid; expense uuid; n integer; m uuid; m2 uuid; pid uuid;
begin
 insert into auth.users(id,email) values(manager,manager||'@example.invalid'),(resident,resident||'@example.invalid'),(outsider,outsider||'@example.invalid');
 insert into public.companies(id,name,label) values(co,'Expense test','Expense test');
 insert into public.company_members(company_id,user_id,role) values(co,manager,'admin');
 insert into public.company_admin_licenses(company_id,user_id,license_key,billing_cycle,starts_on,expires_on) values(co,manager,gen_random_uuid()::text,'annual',current_date-1,current_date+366);
 insert into public.condominiums(id,company_id,name) values(c,co,'Expense test'),(other_c,co,'Other condo');
 insert into public.fractions(id,condominium_id,code) values(f,c,'A');
 insert into public.condominium_members(condominium_id,fraction_id,user_id,is_condominium_admin) values(c,f,resident,true);
 perform set_config('request.jwt.claim.sub',manager::text,true);set local role authenticated;

 insert into public.fraction_charges(condominium_id,fraction_id,period_year,period_month,description,amount_due,due_date) values(c,f,2026,1,'Jan',75,current_date-10),(c,f,2026,2,'Feb',75,current_date-5);
 insert into public.bank_movements(condominium_id,account,booked_on,amount,description,fingerprint) values(c,'Main',current_date,100,'Fração A','') returning id into m;
 n:=public.reconcile_bank_movements(jsonb_build_array(jsonb_build_object('id',m,'fraction_id',f)));
 if n<>1 then raise exception 'TEST FAILED: reconcile';end if;
 select payment_id into pid from public.bank_movements where id=m;
 if (select sum(amount) from public.payment_allocations where payment_id=pid)<>100 then raise exception 'TEST FAILED: allocation across months';end if;
 begin
 perform public.reconcile_bank_movements(jsonb_build_array(jsonb_build_object('id',m,'fraction_id',f)));raise exception 'TEST FAILED: double confirmation';exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 insert into public.bank_movements(condominium_id,account,booked_on,amount,description,fingerprint) values(c,'MAIN',current_date,100,'Fração A','') on conflict(condominium_id,account,fingerprint) do nothing;
 if (select count(*) from public.bank_movements where condominium_id=c)<>1 then raise exception 'TEST FAILED: import duplicate';end if;
 insert into public.bank_movements(condominium_id,account,booked_on,amount,description,fingerprint) values(c,'Main',current_date,100,'Other reference','') returning id into m2;
 begin
 perform public.reconcile_bank_movements(jsonb_build_array(jsonb_build_object('id',m2,'fraction_id',f)));raise exception 'TEST FAILED: duplicate payment';exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 update public.bank_movements set status='pending',note='Wrong association' where id=m;
 if not exists(select 1 from public.fraction_payments where id=pid) then raise exception 'TEST FAILED: reopening removed payment';end if;
 perform public.reconcile_bank_movements(jsonb_build_array(jsonb_build_object('id',m2,'payment_id',pid)));
 insert into public.condominium_expenses(condominium_id,description,amount,due_on) values(c,'Electricity',80,current_date) returning id into expense;
 insert into public.bank_movements(condominium_id,account,booked_on,amount,description,fingerprint) values(c,'Main',current_date,-80,'Invoice','') returning id into m;
 perform public.reconcile_bank_movements(jsonb_build_array(jsonb_build_object('id',m,'expense_id',expense)));
 if (select status from public.condominium_expenses where id=expense)<>'paid' then raise exception 'TEST FAILED: debit settlement';end if;
 insert into public.condominium_budgets(condominium_id,year,category,amount) values(c,2026,'Electricity',1000);
 insert into storage.objects(bucket_id,name) values('expense-invoices',c::text||'/'||expense::text||'/test.pdf');
 insert into public.expense_documents(condominium_id,expense_id,file_path,file_name) values(c,expense,c::text||'/'||expense::text||'/test.pdf','test.pdf');
 begin
 insert into public.expense_documents(condominium_id,expense_id,file_path,file_name) values(other_c,expense,other_c::text||'/'||expense::text||'/test.pdf','test.pdf');raise exception 'TEST FAILED: cross condo document';exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',resident::text,true);
 if exists(select 1 from public.bank_movements where condominium_id=c) or exists(select 1 from public.condominium_budgets where condominium_id=c) or exists(select 1 from public.expense_documents where condominium_id=c) or exists(select 1 from storage.objects where bucket_id='expense-invoices' and name=c::text||'/'||expense::text||'/test.pdf') then raise exception 'TEST FAILED: resident access';end if;
 begin
 insert into public.bank_movements(condominium_id,account,booked_on,amount,fingerprint) values(c,'Main',current_date,50,'');raise exception 'TEST FAILED: resident insert';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from public.bank_movements where condominium_id=c) then raise exception 'TEST FAILED: outsider access';end if;
 reset role;
end $$;
select 'PASS: imports deduplicate, partial/multi-month allocation, duplicate guard, existing-payment linking, debit settlement, budgets, invoice isolation and resident/outsider RLS' as result;
rollback;
