create table public.email_dispatch_config(id integer primary key check(id=1),enabled boolean not null default false,cron_secret text not null default gen_random_uuid()::text,verified_at timestamptz,last_error text);
insert into public.email_dispatch_config(id) values(1);
alter table public.email_dispatch_config enable row level security;
revoke all on public.email_dispatch_config from anon,authenticated;
grant all on public.email_dispatch_config to service_role;
create table public.notification_emails(notification_id uuid primary key references public.notifications(id) on delete cascade,status text not null default 'pending' check(status in('pending','sending','retry','sent','skipped','review')),attempts integer not null default 0,created_at timestamptz not null default now(),next_attempt_at timestamptz not null default now(),claimed_at timestamptz,sent_at timestamptz,last_error text);
alter table public.notification_emails enable row level security;
revoke all on public.notification_emails from anon,authenticated;
grant all on public.notification_emails to service_role;
create index notification_emails_pending on public.notification_emails(next_attempt_at) where status in ('pending','retry');
-- Notifications are only inserted by trusted internal writers. No old alerts are backfilled.
create function private.queue_notification_email() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.notification_emails(notification_id) values(new.id) on conflict do nothing;return new;
end $$;
revoke all on function private.queue_notification_email() from public,anon,authenticated;
create trigger notification_email_queue after insert on public.notifications for each row execute function private.queue_notification_email();
create function public.claim_notification_email() returns setof public.notification_emails language plpgsql security invoker set search_path='' as $$
begin
 -- Serialize workers and cap this Gmail sender at 400 claimed messages per rolling day.
 perform pg_catalog.pg_advisory_xact_lock(818181);
 if not exists(select 1 from public.email_dispatch_config where id=1 and enabled) then return;end if;
 update public.notification_emails set status='review',last_error='Envio interrompido: confirmar entrega antes de repetir.' where status='sending' and claimed_at<now()-interval '10 minutes';
 if (select count(*) from public.notification_emails where claimed_at>now()-interval '24 hours')>=400 then return;end if;
 return query update public.notification_emails q set status='sending',attempts=q.attempts+1,claimed_at=now()
 where q.notification_id=(select notification_id from public.notification_emails where status in('pending','retry') and next_attempt_at<=now() and attempts<5 order by created_at for update skip locked limit 1) returning q.*;
end $$;
create function public.can_receive_notification_email(p_notification_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.notifications n where n.id=p_notification_id and (
 exists(select 1 from public.profiles p where p.user_id=n.user_id and p.is_super_admin)
 or (n.condominium_id is null and exists(select 1 from public.company_members m where m.user_id=n.user_id and m.company_id=n.company_id and m.status='active'))
 or (n.condominium_id is not null and (
 exists(select 1 from public.condominium_members m where m.user_id=n.user_id and m.condominium_id=n.condominium_id and m.status='active')
 or exists(select 1 from public.condominium_staff_assignments a where a.user_id=n.user_id and a.condominium_id=n.condominium_id and a.status='active')
 or exists(select 1 from public.company_members m where m.user_id=n.user_id and m.company_id=n.company_id and m.role='admin' and m.status='active')))));
$$;
revoke all on function public.claim_notification_email(),public.can_receive_notification_email(uuid) from public,anon,authenticated;
grant execute on function public.claim_notification_email(),public.can_receive_notification_email(uuid) to service_role;
select cron.schedule('condomia-email-dispatch','*/2 * * * *',$job$
select net.http_post(url:='https://pvfrlirjdauncoudkomu.supabase.co/functions/v1/email-dispatch',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),body:='{}'::jsonb,timeout_milliseconds:=60000) from public.email_dispatch_config where id=1 and enabled;
$job$);
