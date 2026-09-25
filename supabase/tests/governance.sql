-- Run as the database owner. All fixtures are rolled back, including on failure.
begin;
do $$
declare
 admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
 co uuid:=gen_random_uuid(); other_co uuid:=gen_random_uuid(); condo uuid:=gen_random_uuid(); other_condo uuid:=gen_random_uuid();
 fraction uuid:=gen_random_uuid(); other_fraction uuid:=gen_random_uuid(); assembly uuid; draft uuid; poll uuid; expired uuid; ballot uuid;
 payload jsonb; n integer;
begin
 insert into auth.users(id,email) values(admin_id,admin_id||'@example.invalid'),(owner_id,owner_id||'@example.invalid'),(outsider_id,outsider_id||'@example.invalid');
 insert into public.companies(id,name,label) values(co,'Governance test','Governance test'),(other_co,'Other test','Other test');
 insert into public.company_members(company_id,user_id,role) values(co,admin_id,'admin');
 insert into public.company_admin_licenses(company_id,user_id,license_key,billing_cycle,starts_on,expires_on) values(co,admin_id,gen_random_uuid()::text,'annual',current_date-1,current_date+366);
 insert into public.condominiums(id,company_id,name) values(condo,co,'Test condominium'),(other_condo,other_co,'Other condominium');
 insert into public.fractions(id,condominium_id,code,permillage) values(fraction,condo,'A',125),(other_fraction,other_condo,'B',200);
 insert into public.condominium_members(condominium_id,fraction_id,user_id,member_role) values(condo,fraction,owner_id,'owner'),(other_condo,other_fraction,outsider_id,'owner');
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 set local role authenticated;
 insert into public.assemblies(condominium_id,title,scheduled_for,location,agenda,status) values(condo,'Test assembly',now()+interval '1 day','Sala','Contas','scheduled') returning id into assembly;
 insert into public.assemblies(condominium_id,title,scheduled_for,location,agenda) values(condo,'Draft assembly',now()+interval '1 day','Sala','Contas') returning id into draft;
 insert into public.polls(condominium_id,assembly_id,title,opens_at,closes_at,status) values(condo,assembly,'Budget',now()-interval '1 hour',now()+interval '1 day','open') returning id into poll;
 insert into public.polls(condominium_id,title,opens_at,closes_at,status) values(condo,'Expired',now()-interval '2 day',now()-interval '1 day','open') returning id into expired;
 begin
  update public.polls set title='Changed' where id=poll;
  raise exception 'TEST FAILED: published question changed';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 if (select count(*) from public.assemblies where id in (assembly,draft))<>1 then raise exception 'TEST FAILED: draft visibility'; end if;
 begin
  insert into public.assemblies(condominium_id,title,scheduled_for,location,agenda) values(condo,'Forbidden',now(),'Sala','Agenda');
  raise exception 'TEST FAILED: resident created assembly';
 exception when insufficient_privilege then null; end;
 if public.get_poll_results(poll) is not null then raise exception 'TEST FAILED: early resident results'; end if;
 insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice,voter_id,permillage) values(poll,other_condo,fraction,'yes',outsider_id,999) returning id into ballot;
 if not exists(select 1 from public.poll_votes where id=ballot and voter_id=owner_id and condominium_id=condo and permillage=125) then raise exception 'TEST FAILED: authoritative ballot values'; end if;
 begin
  insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice) values(poll,condo,fraction,'no');
  raise exception 'TEST FAILED: duplicate accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice) values(expired,condo,fraction,'no');
  raise exception 'TEST FAILED: expired vote accepted';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 begin
  insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice) values(poll,condo,other_fraction,'no');
  raise exception 'TEST FAILED: foreign fraction accepted';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 begin
  update public.poll_votes set choice='no' where id=ballot;
  raise exception 'TEST FAILED: ballot changed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 if exists(select 1 from public.assemblies where id=assembly) or exists(select 1 from public.polls where id=poll) or exists(select 1 from public.poll_votes where id=ballot) then raise exception 'TEST FAILED: cross condominium disclosure'; end if;
 begin
  perform public.get_poll_results(poll);
  raise exception 'TEST FAILED: foreign results disclosed';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 update public.polls set status='closed' where id=poll;
 update public.assemblies set status='completed',minutes='Approved minutes' where id=assembly;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 payload:=public.get_poll_results(poll);
 if payload<> '[{"choice":"yes","votes":1,"permillage":125}]'::jsonb then raise exception 'TEST FAILED: aggregate results %',payload; end if;
 if not exists(select 1 from public.assemblies where id=assembly and minutes='Approved minutes') then raise exception 'TEST FAILED: published minutes missing'; end if;
 reset role;
end;
$$;
select 'PASS: manager publishing, resident reading, draft isolation, one vote per fraction, authoritative weight and voter, immutable ballot, closed poll, cross-condominium isolation, results and minutes' as test_result;
rollback;
