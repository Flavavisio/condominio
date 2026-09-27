begin;
do $$
declare sa uuid:=gen_random_uuid(); adm uuid:=gen_random_uuid(); co uuid:=gen_random_uuid(); l public.company_admin_licenses; original_end date; n integer;
begin
 insert into auth.users(id,email) values(sa,sa||'@example.invalid'),(adm,adm||'@example.invalid');
 update public.profiles set is_super_admin=true where user_id=sa;
 insert into public.companies(id,name,label) values(co,'Cycle test','Cycle test');
 insert into public.company_members(company_id,user_id,role) values(co,adm,'admin');
 perform set_config('request.jwt.claim.sub',sa::text,true);set local role authenticated;
 l:=public.issue_automatic_company_license(co,adm,'annual','condomia_10',1);
 if l.starts_on<>current_date or l.expires_on<>(current_date+interval '1 year - 1 day')::date or l.monthly_price*12<>1920 then raise exception 'TEST FAILED annual issue';end if;
 if not exists(select 1 from public.companies where id=co and contract_end=l.expires_on and billing_cycle='annual') then raise exception 'TEST FAILED contract';end if;
 l:=public.manage_automatic_company_license(l.id,'edit','monthly','condomia_10',1);
 if l.expires_on<>(current_date+interval '1 month - 1 day')::date then raise exception 'TEST FAILED cycle change';end if;
 original_end:=l.expires_on;
 l:=public.manage_automatic_company_license(l.id,'renew','annual','condomia_10',1);
 if l.starts_on>current_date or l.expires_on<>(original_end+1+interval '1 year - 1 day')::date then raise exception 'TEST FAILED renewal interrupts access';end if;
 perform public.set_company_admin_license_status(l.id,'suspended');original_end:=l.expires_on;
 l:=public.manage_automatic_company_license(l.id,'reactivate','annual','condomia_10',1);
 if l.status<>'active' or l.expires_on<>original_end then raise exception 'TEST FAILED suspended reactivation';end if;
 update public.company_admin_licenses set starts_on=current_date-40,expires_on=current_date-1,status='expired' where id=l.id;
 reset role;
 perform public.generate_company_admin_license_notifications();
 select count(*) into n from public.notifications where company_id=co and title='Licença expirada' and user_id in(sa,adm);
 if n<>2 then raise exception 'TEST FAILED expiry recipients %',n;end if;
 perform public.generate_company_admin_license_notifications();
 if (select count(*) from public.notifications where company_id=co and title='Licença expirada' and user_id in(sa,adm))<>2 then raise exception 'TEST FAILED duplicate reminders';end if;
 set local role authenticated;
 l:=public.manage_automatic_company_license(l.id,'reactivate','monthly','condomia_50',2);
 if l.starts_on<>current_date or l.expires_on<>(current_date+interval '1 month - 1 day')::date or l.status<>'active' or l.monthly_price<>540 then raise exception 'TEST FAILED expired reactivation';end if;
 perform public.configure_company_license_plan(co,'condomia_10',1,'annual');
 if not exists(select 1 from public.company_admin_licenses where id=l.id and billing_cycle='annual' and monthly_price=160) then raise exception 'TEST FAILED company plan sync';end if;
 perform set_config('request.jwt.claim.sub',adm::text,true);
 begin
 perform public.manage_automatic_company_license(l.id,'reactivate','annual','condomia_10',1);raise exception 'TEST FAILED admin elevated';
 exception when insufficient_privilege then null;end;
 begin
 perform public.generate_company_admin_license_notifications();raise exception 'TEST FAILED public cron';
 exception when insufficient_privilege then null;end;
 reset role;
end $$;
select 'PASS automatic issue, cycle change, gap-free renewal, reactivation, expiry notifications to both roles, deduplication and authorization' result;
rollback;
