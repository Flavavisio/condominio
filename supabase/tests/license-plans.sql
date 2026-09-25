begin;
do $$
declare sa uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); co uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); l public.company_admin_licenses; i integer;
begin
 insert into auth.users(id,email) values(sa,sa||'@example.invalid'),(admin_id,admin_id||'@example.invalid');
 update public.profiles set is_super_admin=true where user_id=sa;
 insert into public.companies(id,name,label) values(co,'Plan test','Plan test');
 insert into public.company_members(company_id,user_id,role) values(co,admin_id,'admin');
 perform set_config('request.jwt.claim.sub',sa::text,true);set local role authenticated;
 l:=public.issue_planned_company_license(co,admin_id,'monthly',current_date,'condomia_1','Test');
 if l.monthly_price<>11.90 or l.condominium_limit<>1 or not l.vat_included then raise exception 'TEST FAILED: plan price';end if;
 insert into public.condominiums(id,company_id,name) values(c,co,'One');
 begin
 insert into public.condominiums(company_id,name) values(co,'Exceeds');raise exception 'TEST FAILED: exceeded capacity';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 l:=public.update_planned_company_license(l.id,'monthly',current_date,current_date+30,'condomia_10','Upgrade');
 if l.monthly_price<>80 or (select licensed_condominium_limit from public.companies where id=co)<>10 then raise exception 'TEST FAILED: upgrade';end if;
 insert into public.condominiums(company_id,name) values(co,'Two');
 begin
 perform public.update_planned_company_license(l.id,'monthly',current_date,current_date+30,'condomia_1','Downgrade');raise exception 'TEST FAILED: invalid downgrade accepted';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 begin
 perform public.issue_planned_company_license(co,admin_id,'monthly',current_date,'condomia_200','Forbidden');raise exception 'TEST FAILED: admin can issue';
 exception when insufficient_privilege then null;end;
 begin
 update public.companies set licensed_condominium_limit=1000 where id=co;raise exception 'TEST FAILED: admin can increase capacity';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',sa::text,true);
 l:=public.update_planned_company_license(l.id,'annual',current_date,current_date+364,'condomia_200','Annual');
 if l.monthly_price<>1200 or l.condominium_limit<>200 then raise exception 'TEST FAILED: 200 plan mismatch';end if;
 l:=public.renew_company_admin_license(l.id,'monthly');
 if l.plan_id<>'condomia_200' or l.monthly_price<>1200 then raise exception 'TEST FAILED: renewal lost plan';end if;
 reset role;
end $$;
select 'PASS: confirmed prices/VAT, issuance, capacity cap, upgrade, downgrade rejection, authorization and renewal' as result;
rollback;
