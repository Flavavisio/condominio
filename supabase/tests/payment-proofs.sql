begin;
do $$
declare manager uuid:=gen_random_uuid(); r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); co uuid:=gen_random_uuid(); condo uuid:=gen_random_uuid(); f1 uuid:=gen_random_uuid(); f2 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); c3 uuid:=gen_random_uuid(); proof uuid; proof2 uuid; obj text; n integer; res public.payment_proofs;
begin
 insert into auth.users(id,email) values(manager,manager||'@example.invalid'),(r1,r1||'@example.invalid'),(r2,r2||'@example.invalid');
 insert into public.companies(id,name,label) values(co,'Payment proof test','Payment proof test');
 insert into public.company_members(company_id,user_id,role) values(co,manager,'admin');
 insert into public.company_admin_licenses(company_id,user_id,license_key,billing_cycle,starts_on,expires_on) values(co,manager,gen_random_uuid()::text,'annual',current_date-1,current_date+366);
 insert into public.condominiums(id,company_id,name) values(condo,co,'Payment test');
 insert into public.fractions(id,condominium_id,code,permillage) values(f1,condo,'A',500),(f2,condo,'B',500);
 insert into public.condominium_members(condominium_id,fraction_id,user_id,is_condominium_admin) values(condo,f1,r1,true),(condo,f2,r2,false);
 insert into public.fraction_charges(id,condominium_id,fraction_id,period_year,period_month,description,amount_due,due_date) values(c1,condo,f1,2026,8,'Agosto',100,current_date-30),(c2,condo,f2,2026,8,'Agosto B',200,current_date-30),(c3,condo,f1,2026,9,'Setembro',50,current_date-1);
 insert into public.documents(condominium_id,name,category,file_path) values(condo,'Private document','other','test.pdf');
 perform set_config('request.jwt.claim.sub',r1::text,true); set local role authenticated;
 if public.can_manage_condo_finance(condo) then raise exception 'TEST FAILED: resident admin can manage finance'; end if;
 if (select count(*) from public.fraction_charges where condominium_id=condo)<>2 then raise exception 'TEST FAILED: cross-fraction financial visibility'; end if;
 if exists(select 1 from public.documents where condominium_id=condo) then raise exception 'TEST FAILED: excluded module accessible'; end if;
 begin
 perform public.settle_fraction_charge(c1,current_date,'other'); raise exception 'TEST FAILED: resident can settle debt';
 exception when insufficient_privilege then null; end;
 obj:=r1::text||'/'||f1::text||'/'||gen_random_uuid()::text||'.pdf';
 insert into storage.objects(bucket_id,name,owner_id) values('payment-proofs',obj,r1::text);
 begin
 insert into storage.objects(bucket_id,name,owner_id) values('payment-proofs',r1::text||'/'||f2::text||'/invalid.pdf',r1::text);
 raise exception 'TEST FAILED: upload for another fraction allowed'; exception when insufficient_privilege then null; end;
 insert into public.payment_proofs(condominium_id,fraction_id,charge_id,submitted_by,file_path,file_name,amount,paid_on,status) values(condo,f1,c1,r1,obj,'proof.pdf',100,current_date,'approved') returning id into proof;
 if (select status from public.payment_proofs where id=proof)<>'pending' then raise exception 'TEST FAILED: status spoof'; end if;
 if exists(select 1 from public.fraction_payments where fraction_id=f1) then raise exception 'TEST FAILED: upload settled debt'; end if;
 begin
 perform public.review_payment_proof(proof,true,''); raise exception 'TEST FAILED: resident approved payment'; exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 update storage.objects set name=obj||'.changed' where bucket_id='payment-proofs' and name=obj;
 get diagnostics n=row_count; if n<>0 then raise exception 'TEST FAILED: submitted file changed'; end if;
 perform set_config('request.jwt.claim.sub',r2::text,true);
 if exists(select 1 from public.payment_proofs where id=proof) or exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=obj) then raise exception 'TEST FAILED: other fraction can see proof'; end if;
 perform set_config('request.jwt.claim.sub',manager::text,true);
 if not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=obj) then raise exception 'TEST FAILED: manager cannot read proof'; end if;
 if not exists(select 1 from public.notifications where payload->>'proof_id'=proof::text) then raise exception 'TEST FAILED: manager not notified'; end if;
 res:=public.review_payment_proof(proof,true,'Conferido');
 if res.payment_id is null or res.reviewed_by<>manager or res.status<>'approved' then raise exception 'TEST FAILED: missing audit'; end if;
 if (select status from public.fraction_charges where id=c1)<>'paid' then raise exception 'TEST FAILED: debt not settled'; end if;
 begin
 perform public.review_payment_proof(proof,true,''); raise exception 'TEST FAILED: duplicate approval'; exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 if (select count(*) from public.fraction_payments where fraction_id=f1)<>1 then raise exception 'TEST FAILED: duplicate payment'; end if;
 perform set_config('request.jwt.claim.sub',r1::text,true);
 obj:=r1::text||'/'||f1::text||'/'||gen_random_uuid()::text||'.png';
 insert into storage.objects(bucket_id,name,owner_id) values('payment-proofs',obj,r1::text);
 insert into public.payment_proofs(condominium_id,fraction_id,charge_id,submitted_by,file_path,file_name,amount,paid_on) values(condo,f1,c3,r1,obj,'partial.png',20,current_date) returning id into proof2;
 perform set_config('request.jwt.claim.sub',manager::text,true);
 begin
 perform public.review_payment_proof(proof2,false,'');raise exception 'TEST FAILED: rejection without reason';exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 res:=public.review_payment_proof(proof2,false,'Não corresponde ao pagamento.');
 if (select status from public.fraction_charges where id=c3)<>'open' then raise exception 'TEST FAILED: rejection changed debt';end if;
 perform set_config('request.jwt.claim.sub',r1::text,true);
 obj:=r1::text||'/'||f1::text||'/'||gen_random_uuid()::text||'.png';insert into storage.objects(bucket_id,name,owner_id) values('payment-proofs',obj,r1::text);
 insert into public.payment_proofs(condominium_id,fraction_id,charge_id,submitted_by,file_path,file_name,amount,paid_on) values(condo,f1,c3,r1,obj,'replacement.png',20,current_date) returning id into proof2;
 perform set_config('request.jwt.claim.sub',manager::text,true);res:=public.review_payment_proof(proof2,true,'');
 if (select status from public.fraction_charges where id=c3)<>'partial' then raise exception 'TEST FAILED: partial payment';end if;
 begin
 insert into public.payment_allocations(payment_id,charge_id,amount) values(res.payment_id,c2,1);raise exception 'TEST FAILED: cross-fraction allocation';exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise;end if;end;
 reset role;
end $$;
select 'PASS: own-fraction finance including resident admins, private uploads, pending debt, manager notification/review, atomic settlement, duplicate protection, rejection/resubmission, partial payments and fraction allocation isolation' as result;
rollback;
