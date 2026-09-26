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

 update public.condominiums set name='Edited test' where id=c;
 if not found then raise exception 'TEST FAILED: manager cannot edit';end if;
 insert into storage.objects(bucket_id,name) values('condominium-photos',c::text||'/test.jpg');
 perform set_config('request.jwt.claim.sub',resident::text,true);
 if not exists(select 1 from storage.objects where bucket_id='condominium-photos' and name=c::text||'/test.jpg') then raise exception 'TEST FAILED: resident cannot read';end if;
 update public.condominiums set name='Forbidden' where id=c;
 if found then raise exception 'TEST FAILED: resident can edit';end if;
 begin
 insert into storage.objects(bucket_id,name) values('condominium-photos',c::text||'/forbidden.jpg');
 raise exception 'TEST FAILED: resident can upload';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from storage.objects where bucket_id='condominium-photos' and name=c::text||'/test.jpg') then raise exception 'TEST FAILED: outsider can read';end if;
 reset role;
end $$;
select 'PASS: manager edits/uploads, resident read-only, outsider isolated' as result;
rollback;
