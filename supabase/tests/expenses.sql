begin;
do $$
declare manager uuid:=gen_random_uuid(); resident uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); co uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); contract uuid; expense uuid; n integer;
begin
 insert into auth.users(id,email) values(manager,manager||'@example.invalid'),(resident,resident||'@example.invalid'),(outsider,outsider||'@example.invalid');
 insert into public.companies(id,name,label) values(co,'Expense test','Expense test');
 insert into public.company_members(company_id,user_id,role) values(co,manager,'admin');
 insert into public.company_admin_licenses(company_id,user_id,license_key,billing_cycle,starts_on,expires_on) values(co,manager,gen_random_uuid()::text,'annual',current_date-1,current_date+366);
 insert into public.condominiums(id,company_id,name) values(c,co,'Expense test'),(other_c,co,'Other condo');
 insert into public.fractions(id,condominium_id,code) values(f,c,'A');
 insert into public.condominium_members(condominium_id,fraction_id,user_id,is_condominium_admin) values(c,f,resident,true);
 perform set_config('request.jwt.claim.sub',manager::text,true);set local role authenticated;
 insert into public.service_contracts(condominium_id,title,amount,interval_months,starts_on,next_due_on) values(c,'Limpeza',200,1,date_trunc('month',current_date)::date,date_trunc('month',current_date)::date) returning id into contract;
 n:=public.generate_service_expenses(c);if n<>1 then raise exception 'TEST FAILED: first generation';end if;
 n:=public.generate_service_expenses(c);if n<>0 then raise exception 'TEST FAILED: duplicated expense';end if;
 select id into expense from public.condominium_expenses where contract_id=contract;
 update public.condominium_expenses set status='paid',paid_on=current_date where id=expense;
 begin
 update public.condominium_expenses set amount=1 where id=expense;raise exception 'TEST FAILED: changed paid amount';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 begin
 insert into public.condominium_expenses(condominium_id,contract_id,description,amount,due_on) values(other_c,contract,'Wrong condo',10,current_date);raise exception 'TEST FAILED: cross condo contract';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 insert into public.condominium_balance_settings(condominium_id,opening_on,opening_amount) values(c,current_date,2000);
 insert into public.service_contracts(condominium_id,title,amount,interval_months,starts_on,next_due_on,ends_on) values(c,'Month-end test',10,1,'2026-01-31','2026-01-31','2026-04-30') returning id into contract;
 n:=public.generate_service_expenses(c);if n<>4 then raise exception 'TEST FAILED: recurrence month-end count';end if;
 if not exists(select 1 from public.condominium_expenses where contract_id=contract and due_on='2026-02-28') or not exists(select 1 from public.condominium_expenses where contract_id=contract and due_on='2026-03-31') then raise exception 'TEST FAILED: month anchor drift';end if;
 perform set_config('request.jwt.claim.sub',resident::text,true);
 if exists(select 1 from public.condominium_expenses where condominium_id=c) or exists(select 1 from public.service_contracts where condominium_id=c) or exists(select 1 from public.condominium_balance_settings where condominium_id=c) then raise exception 'TEST FAILED: resident sees company financial data';end if;
 begin
 perform public.generate_service_expenses(c);raise exception 'TEST FAILED: resident generates';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from public.condominium_expenses where condominium_id=c) then raise exception 'TEST FAILED: outsider sees expenses';end if;
 reset role;
end $$;
select 'PASS: recurrence idempotency, paid amount protection, cross-condominium guard, resident and outsider RLS' as result;
rollback;
