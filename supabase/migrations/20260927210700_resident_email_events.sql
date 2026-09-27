-- These triggers run only after RLS has authorized the underlying change.
create function private.governance_email_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare co uuid; event text; heading text; message text;
begin
 if auth.uid() is null then return new;end if;
 select company_id into co from public.condominiums where id=new.condominium_id;
 if TG_TABLE_NAME='assemblies' then
   if new.status<>'scheduled' or (TG_OP='UPDATE' and old.status=new.status and old.scheduled_for=new.scheduled_for) then return new;end if;
   event:='assembly:'||new.id||':'||new.scheduled_for;heading:='Assembleia agendada';message:=new.title||' · '||to_char(new.scheduled_for at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI')||'. Consulte a convocatória na aplicação.';
 elsif TG_TABLE_NAME='polls' then
   if new.status<>'open' or (TG_OP='UPDATE' and old.status=new.status) then return new;end if;
   event:='poll:'||new.id||':open';heading:='Votação publicada';message:=new.title||'. Consulte as datas e participe na aplicação.';
 else
   if new.published_at>now() then return new;end if;
   event:='notice:'||new.id;heading:='Novo aviso do condomínio';message:=new.title||'. Consulte o aviso na aplicação.';
 end if;
 insert into public.notifications(user_id,company_id,condominium_id,event_key,kind,title,body,url)
 select distinct m.user_id,co,new.condominium_id,event,TG_TABLE_NAME,heading,message,'./app.html'
 from public.condominium_members m where m.condominium_id=new.condominium_id and m.status='active'
 on conflict(user_id,event_key) do nothing;
 return new;
end $$;
revoke all on function private.governance_email_notice() from public,anon,authenticated;
create trigger assembly_email_notice after insert or update of status,scheduled_for on public.assemblies for each row execute function private.governance_email_notice();
create trigger poll_email_notice after insert or update of status on public.polls for each row execute function private.governance_email_notice();
create trigger resident_notice_email after insert on public.notices for each row execute function private.governance_email_notice();
create function private.payment_review_email_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare co uuid;
begin
 if auth.uid() is null or new.status=old.status or new.status not in ('approved','rejected') then return new;end if;
 select company_id into co from public.condominiums where id=new.condominium_id;
 insert into public.notifications(user_id,company_id,condominium_id,event_key,kind,title,body,url)
 values(new.submitted_by,co,new.condominium_id,'proof-review:'||new.id||':'||new.status,'payment_review',case when new.status='approved' then 'Comprovativo de pagamento aprovado' else 'Comprovativo de pagamento rejeitado' end,'Consulte o resultado da validação no Financeiro da sua fração.','./app.html')
 on conflict(user_id,event_key) do nothing;
 return new;
end $$;
revoke all on function private.payment_review_email_notice() from public,anon,authenticated;
create trigger payment_review_email_notice after update of status on public.payment_proofs for each row execute function private.payment_review_email_notice();
