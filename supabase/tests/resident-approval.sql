begin;
do $$
declare
 gestora uuid:=gen_random_uuid(); resident uuid:=gen_random_uuid(); admin_a uuid:=gen_random_uuid(); admin_b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 co uuid:=gen_random_uuid(); condo uuid:=gen_random_uuid(); other_condo uuid:=gen_random_uuid();
 fa uuid:=gen_random_uuid(); fb uuid:=gen_random_uuid(); fc uuid:=gen_random_uuid(); fd uuid:=gen_random_uuid(); issue uuid; rejected uuid; direct_issue uuid; poll uuid; affected integer; v public.issues;
begin
 insert into auth.users(id,email) values(gestora,gestora||'@example.invalid'),(resident,resident||'@example.invalid'),(admin_a,admin_a||'@example.invalid'),(admin_b,admin_b||'@example.invalid'),(outsider,outsider||'@example.invalid');
 insert into public.companies(id,name,label) values(co,'Resident workflow test','Resident workflow test');
 insert into public.company_members(company_id,user_id,role) values(co,gestora,'admin');
 insert into public.company_admin_licenses(company_id,user_id,license_key,billing_cycle,starts_on,expires_on) values(co,gestora,gen_random_uuid()::text,'annual',current_date-1,current_date+366);
 insert into public.condominiums(id,company_id,name) values(condo,co,'Test A'),(other_condo,co,'Test B');
 insert into public.fractions(id,condominium_id,code,permillage) values(fa,condo,'A',250),(fb,condo,'B',250),(fc,condo,'C',250),(fd,other_condo,'D',1000);
 insert into public.condominium_members(condominium_id,fraction_id,user_id) values(condo,fa,admin_a),(condo,fb,admin_b),(condo,fc,resident),(other_condo,fd,outsider);
 perform set_config('request.jwt.claim.sub',gestora::text,true); set local role authenticated;
 perform public.set_condominium_resident_admin(condo,admin_a,true);
 perform public.set_condominium_resident_admin(condo,admin_b,true);
 begin
   perform public.set_condominium_resident_admin(condo,resident,true);
   raise exception 'TEST FAILED: third admin accepted';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 perform public.set_condominium_resident_admin(condo,admin_b,false);
 perform public.set_condominium_resident_admin(condo,resident,true);
 perform public.set_condominium_resident_admin(condo,resident,false);
 perform public.set_condominium_resident_admin(condo,admin_b,true);
 begin
   insert into public.condominium_members(condominium_id,fraction_id,user_id) values(condo,fd,outsider);
   raise exception 'TEST FAILED: mismatched fraction accepted';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 insert into public.polls(condominium_id,title,opens_at,closes_at,status) values(condo,'Vote test',now()-interval '1 hour',now()+interval '1 day','open') returning id into poll;
 perform set_config('request.jwt.claim.sub',resident::text,true);
 insert into public.issues(condominium_id,fraction_id,reporter_user_id,title,priority,approval_status,status) values(condo,fc,admin_a,'Approve this test','urgent','approved','resolved') returning id into issue;
 select * into v from public.issues where id=issue;
 if v.approval_status<>'pending' or v.status<>'open' or v.reporter_user_id<>resident then raise exception 'TEST FAILED: resident bypassed approval'; end if;
 begin
   perform public.set_condominium_resident_admin(condo,resident,true);
   raise exception 'TEST FAILED: self promotion accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.review_condominium_issue(issue,true,'');
   raise exception 'TEST FAILED: resident approved';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice) values(poll,condo,fc,'yes');
 perform set_config('request.jwt.claim.sub',gestora::text,true);
 if exists(select 1 from public.issues where id=issue) then raise exception 'TEST FAILED: pending visible to management'; end if;
 if exists(select 1 from public.notifications where payload->>'issue_id'=issue::text) then raise exception 'TEST FAILED: premature management notification'; end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from public.issues where id=issue) then raise exception 'TEST FAILED: cross condominium visibility'; end if;
 perform set_config('request.jwt.claim.sub',admin_a::text,true);
 if not exists(select 1 from public.issues where id=issue) then raise exception 'TEST FAILED: admin cannot see pending'; end if;
 begin
   update public.issues set title='Rewritten',approval_status='approved' where id=issue;
   raise exception 'TEST FAILED: admin rewrote issue';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 v:=public.review_condominium_issue(issue,true,'Verificado');
 if v.approval_status<>'approved' or v.reviewed_by<>admin_a or v.reviewed_at is null then raise exception 'TEST FAILED: review audit'; end if;
 insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice) values(poll,condo,fa,'no');
 insert into public.issues(condominium_id,title) values(condo,'Admin direct test') returning id into direct_issue;
 if not exists(select 1 from public.issues where id=direct_issue and approval_status='approved') then raise exception 'TEST FAILED: admin report not forwarded'; end if;
 perform set_config('request.jwt.claim.sub',gestora::text,true);
 if not exists(select 1 from public.issues where id=issue) then raise exception 'TEST FAILED: approved not delivered'; end if;
 if not exists(select 1 from public.notifications where payload->>'issue_id'=issue::text) then raise exception 'TEST FAILED: approval notification missing'; end if;
 update public.issues set status='progress' where id=issue;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'TEST FAILED: management cannot handle issue'; end if;
 perform set_config('request.jwt.claim.sub',resident::text,true);
 insert into public.issues(condominium_id,title) values(condo,'Reject this test') returning id into rejected;
 perform set_config('request.jwt.claim.sub',admin_b::text,true);
 begin
   perform public.review_condominium_issue(rejected,false,'');
   raise exception 'TEST FAILED: empty rejection accepted';
 exception when raise_exception then if SQLERRM like 'TEST FAILED:%' then raise; end if; end;
 perform public.review_condominium_issue(rejected,false,'Ocorrência duplicada.');
 perform set_config('request.jwt.claim.sub',resident::text,true);
 if not exists(select 1 from public.issues where id=rejected and approval_status='rejected' and review_note='Ocorrência duplicada.') then raise exception 'TEST FAILED: author cannot see rejection'; end if;
 begin
   insert into public.poll_votes(poll_id,condominium_id,fraction_id,choice) values(poll,condo,fc,'no');
   raise exception 'TEST FAILED: duplicate vote';
 exception when unique_violation then null; end;
 perform set_config('request.jwt.claim.sub',gestora::text,true);
 if exists(select 1 from public.issues where id=rejected) then raise exception 'TEST FAILED: rejected visible to management'; end if;
 reset role;
end;
$$;
select 'PASS: fraction isolation, two-admin limit and replacement, no self-promotion, forced approval queue, management and notification isolation, approval audit, rejection reason, management treatment, independent fraction ballots and duplicate prevention' as test_result;
rollback;
