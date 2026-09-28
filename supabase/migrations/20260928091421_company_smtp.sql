grant usage on schema private to service_role;
-- Credentials are encrypted in Vault. Only service-role Edge Functions may use these APIs.
create table public.company_smtp (
 company_id uuid primary key references public.companies(id) on delete cascade,
 secret_id uuid not null,
 verified_at timestamptz,
 revision uuid not null default gen_random_uuid(),
 last_test_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now()
);
alter table public.company_smtp enable row level security;
revoke all on public.company_smtp from public,anon,authenticated;
grant all on public.company_smtp to service_role;
create table public.auth_email_routes (
 email text primary key, company_id uuid references public.companies(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '1 day'
);
alter table public.auth_email_routes enable row level security;
revoke all on public.auth_email_routes from public,anon,authenticated;
grant all on public.auth_email_routes to service_role;
create function private.company_smtp_secret(p_company_id uuid,p_config jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; result jsonb;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Forbidden'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text,14));
 select secret_id into sid from public.company_smtp where company_id=p_company_id;
 if p_config is null then
  select decrypted_secret::jsonb into result from vault.decrypted_secrets where id=sid;
  return result;
 end if;
 if coalesce(p_config->>'password','')='' then
  select decrypted_secret::jsonb into result from vault.decrypted_secrets where id=sid;
  if coalesce(result->>'password','')='' then raise exception 'Indique a palavra-passe SMTP';end if;
  p_config=jsonb_set(p_config,'{password}',result->'password');
 end if;
 if sid is null then
  sid=vault.create_secret(p_config::text);
  insert into public.company_smtp(company_id,secret_id) values(p_company_id,sid);
 else
  perform vault.update_secret(sid,p_config::text);
  update public.company_smtp set verified_at=null,last_error=null,revision=gen_random_uuid(),updated_at=now() where company_id=p_company_id;
 end if;
 return '{"ok":true}'::jsonb;
end $$;
revoke all on function private.company_smtp_secret(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.company_smtp_secret(uuid,jsonb) to service_role;
create function public.company_smtp_secret(p_company_id uuid,p_config jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$select private.company_smtp_secret(p_company_id,p_config);$$;
revoke all on function public.company_smtp_secret(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.company_smtp_secret(uuid,jsonb) to service_role;
-- Remove encrypted credentials when their company is deleted.
create function private.delete_company_smtp_secret() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from vault.secrets where id=old.secret_id;return old;end $$;
revoke all on function private.delete_company_smtp_secret() from public,anon,authenticated;
create trigger delete_company_smtp_secret after delete on public.company_smtp for each row execute function private.delete_company_smtp_secret();
-- Resolve Auth routing from trusted memberships, never editable user_metadata.
create function public.resolve_auth_email_company(p_user_id uuid,p_email text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; route record;
begin
 if exists(select 1 from public.profiles where user_id=p_user_id and is_super_admin)
 or exists(select 1 from public.company_members where user_id=p_user_id and role='admin' and status='active') then return '{"platform":true}'::jsonb;end if;
 select array_agg(distinct company_id) into ids from (
 select company_id from public.company_members where user_id=p_user_id and status='active'
 union select c.company_id from public.condominium_members m join public.condominiums c on c.id=m.condominium_id where m.user_id=p_user_id and m.status='active'
 ) a;
 if cardinality(ids)=1 then return jsonb_build_object('company_id',ids[1]);end if;
 if cardinality(ids)>1 then return '{"ambiguous":true}'::jsonb;end if;
 select * into route from public.auth_email_routes where email=lower(p_email) and expires_at>now();
 if found then return case when route.company_id is null then '{"platform":true}'::jsonb else jsonb_build_object('company_id',route.company_id) end;end if;
 -- An account without membership must not fall back to the platform sender.
 return '{"unassigned":true}'::jsonb;
end $$;
revoke all on function public.resolve_auth_email_company(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_auth_email_company(uuid,text) to service_role;
-- A company without verified SMTP must not consume delivery attempts or block platform mail.
create or replace function public.claim_notification_email() returns setof public.notification_emails language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(818181);
 if not exists(select 1 from public.email_dispatch_config where id=1 and enabled) then return;end if;
 update public.notification_emails set status='review',last_error='Envio interrompido: confirmar entrega antes de repetir.' where status='sending' and claimed_at<now()-interval '10 minutes';
 if (select count(*) from public.notification_emails where claimed_at>now()-interval '24 hours')>=400 then return;end if;
 return query update public.notification_emails q set status='sending',attempts=q.attempts+1,claimed_at=now()
 where q.notification_id=(select e.notification_id from public.notification_emails e join public.notifications n on n.id=e.notification_id
 where e.status in('pending','retry') and e.next_attempt_at<=now() and e.attempts<5
 and (exists(select 1 from public.profiles p where p.user_id=n.user_id and p.is_super_admin)
 or exists(select 1 from public.company_members m where m.company_id=n.company_id and m.user_id=n.user_id and m.role='admin' and m.status='active')
 or exists(select 1 from public.company_smtp s join public.companies c on c.id=s.company_id where s.company_id=n.company_id and s.verified_at is not null and c.status='active'))
 order by e.created_at for update of e skip locked limit 1) returning q.*;
end $$;
