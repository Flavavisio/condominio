create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.company_admin_licenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  license_key text not null unique,
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  starts_on date not null,
  expires_on date not null,
  status text not null default 'active' check (status in ('active','suspended','expired','cancelled')),
  issued_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on >= starts_on)
);
create index if not exists company_admin_licenses_company_idx on public.company_admin_licenses(company_id);
create index if not exists company_admin_licenses_user_idx on public.company_admin_licenses(user_id);
create index if not exists company_admin_licenses_expiry_idx on public.company_admin_licenses(status, expires_on);
create unique index if not exists company_admin_one_active_license_idx on public.company_admin_licenses(company_id,user_id) where status='active';
alter table public.company_admin_licenses enable row level security;

create policy company_admin_licenses_select on public.company_admin_licenses for select to authenticated using (private.is_super_admin() or user_id=(select auth.uid()));
create policy company_admin_licenses_insert on public.company_admin_licenses for insert to authenticated with check (private.is_super_admin());
create policy company_admin_licenses_update on public.company_admin_licenses for update to authenticated using (private.is_super_admin()) with check (private.is_super_admin());
create policy company_admin_licenses_delete on public.company_admin_licenses for delete to authenticated using (private.is_super_admin());
revoke all on public.company_admin_licenses from anon;
grant select,insert,update,delete on public.company_admin_licenses to authenticated;

create or replace function private.has_active_company_admin_license(target_company_id uuid,target_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.company_admin_licenses l where l.company_id=target_company_id and l.user_id=target_user_id and l.status='active' and current_date between l.starts_on and l.expires_on); $$;

create or replace function private.is_company_admin(target_company_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select private.is_super_admin() or exists(select 1 from public.company_members cm where cm.company_id=target_company_id and cm.user_id=(select auth.uid()) and cm.status='active' and cm.role='admin' and private.has_active_company_admin_license(target_company_id,cm.user_id)); $$;

create or replace function private.can_view_condo(target_condominium_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select private.is_super_admin() or private.is_condo_member(target_condominium_id) or private.is_staff_assigned_to_condo(target_condominium_id) or exists(select 1 from public.condominiums c where c.id=target_condominium_id and private.is_company_admin(c.company_id)); $$;

create or replace function private.can_manage_condo(target_condominium_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select private.is_super_admin() or private.is_staff_assigned_to_condo(target_condominium_id) or exists(select 1 from public.condominiums c where c.id=target_condominium_id and private.is_company_admin(c.company_id)); $$;

create or replace function public.list_company_admins_for_licensing()
returns table(company_id uuid,company_name text,user_id uuid,full_name text,email text,member_status text)
language plpgsql security definer set search_path=''
as $$ begin if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501'; end if; return query select c.id,coalesce(nullif(c.label,''),c.name)::text,cm.user_id,coalesce(nullif(p.full_name,''),u.email::text)::text,u.email::text,cm.status::text from public.companies c join public.company_members cm on cm.company_id=c.id and cm.role='admin' join auth.users u on u.id=cm.user_id left join public.profiles p on p.user_id=cm.user_id order by c.name,cm.created_at; end; $$;
revoke all on function public.list_company_admins_for_licensing() from public,anon;
grant execute on function public.list_company_admins_for_licensing() to authenticated;

create or replace function public.list_company_admin_licenses()
returns table(id uuid,company_id uuid,company_name text,user_id uuid,full_name text,email text,license_key text,billing_cycle text,starts_on date,expires_on date,status text,effective_status text,notes text,created_at timestamptz)
language plpgsql security definer set search_path=''
as $$ begin if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501'; end if; return query select l.id,l.company_id,coalesce(nullif(c.label,''),c.name)::text,l.user_id,coalesce(nullif(p.full_name,''),u.email::text)::text,u.email::text,l.license_key,l.billing_cycle,l.starts_on,l.expires_on,l.status,case when l.status='active' and l.expires_on<current_date then 'expired' else l.status end::text,l.notes,l.created_at from public.company_admin_licenses l join public.companies c on c.id=l.company_id join auth.users u on u.id=l.user_id left join public.profiles p on p.user_id=l.user_id order by l.created_at desc; end; $$;
revoke all on function public.list_company_admin_licenses() from public,anon;
grant execute on function public.list_company_admin_licenses() to authenticated;

create or replace function public.issue_company_admin_license(p_company_id uuid,p_user_id uuid,p_billing_cycle text,p_starts_on date default current_date,p_notes text default null)
returns public.company_admin_licenses language plpgsql security definer set search_path=''
as $$ declare v_expiry date; v_row public.company_admin_licenses; v_key text; begin if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501'; end if; if p_billing_cycle not in ('monthly','annual') then raise exception 'Ciclo inválido.'; end if; if not exists(select 1 from public.company_members cm where cm.company_id=p_company_id and cm.user_id=p_user_id and cm.role='admin' and cm.status='active') then raise exception 'O utilizador não é administrador ativo desta empresa.'; end if; update public.company_admin_licenses set status='cancelled',updated_at=now() where company_id=p_company_id and user_id=p_user_id and status='active'; v_expiry:=case when p_billing_cycle='annual' then (p_starts_on+interval '1 year - 1 day')::date else (p_starts_on+interval '1 month - 1 day')::date end; v_key:='CFL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)); insert into public.company_admin_licenses(company_id,user_id,license_key,billing_cycle,starts_on,expires_on,status,issued_by,notes) values(p_company_id,p_user_id,v_key,p_billing_cycle,p_starts_on,v_expiry,'active',(select auth.uid()),nullif(trim(p_notes),'')) returning * into v_row; return v_row; end; $$;
revoke all on function public.issue_company_admin_license(uuid,uuid,text,date,text) from public,anon;
grant execute on function public.issue_company_admin_license(uuid,uuid,text,date,text) to authenticated;

create or replace function public.renew_company_admin_license(p_license_id uuid,p_billing_cycle text default null)
returns public.company_admin_licenses language plpgsql security definer set search_path=''
as $$ declare v public.company_admin_licenses; v_cycle text; v_start date; v_expiry date; begin if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501'; end if; select * into v from public.company_admin_licenses where id=p_license_id for update; if v.id is null then raise exception 'Licença não encontrada.'; end if; v_cycle:=coalesce(p_billing_cycle,v.billing_cycle); if v_cycle not in ('monthly','annual') then raise exception 'Ciclo inválido.'; end if; v_start:=case when v.expires_on>=current_date then v.expires_on+1 else current_date end; v_expiry:=case when v_cycle='annual' then (v_start+interval '1 year - 1 day')::date else (v_start+interval '1 month - 1 day')::date end; update public.company_admin_licenses set billing_cycle=v_cycle,starts_on=v_start,expires_on=v_expiry,status='active',updated_at=now() where id=p_license_id returning * into v; return v; end; $$;
revoke all on function public.renew_company_admin_license(uuid,text) from public,anon;
grant execute on function public.renew_company_admin_license(uuid,text) to authenticated;

create or replace function public.set_company_admin_license_status(p_license_id uuid,p_status text)
returns public.company_admin_licenses language plpgsql security definer set search_path=''
as $$ declare v public.company_admin_licenses; begin if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501'; end if; if p_status not in ('active','suspended','cancelled') then raise exception 'Estado inválido.'; end if; if p_status='active' and exists(select 1 from public.company_admin_licenses where id=p_license_id and expires_on<current_date) then raise exception 'A licença expirou. Use renovar.'; end if; update public.company_admin_licenses set status=p_status,updated_at=now() where id=p_license_id returning * into v; if v.id is null then raise exception 'Licença não encontrada.'; end if; return v; end; $$;
revoke all on function public.set_company_admin_license_status(uuid,text) from public,anon;
grant execute on function public.set_company_admin_license_status(uuid,text) to authenticated;

create or replace function public.expire_company_admin_licenses() returns integer language plpgsql security definer set search_path=''
as $$ declare n integer; begin update public.company_admin_licenses set status='expired',updated_at=now() where status='active' and expires_on<current_date; get diagnostics n=row_count; return n; end; $$;
revoke all on function public.expire_company_admin_licenses() from public,anon,authenticated;

create table if not exists public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,endpoint text not null unique,p256dh text not null,auth text not null,user_agent text,enabled boolean not null default true,last_seen_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id) where enabled=true;
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated with check(user_id=(select auth.uid()));
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using(user_id=(select auth.uid()));
revoke all on public.push_subscriptions from anon;
grant select,insert,update,delete on public.push_subscriptions to authenticated;

create table if not exists public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,company_id uuid references public.companies(id) on delete cascade,condominium_id uuid references public.condominiums(id) on delete cascade,event_key text not null,kind text not null,severity text not null default 'info' check(severity in('info','warning','urgent')),title text not null,body text not null,url text,payload jsonb not null default '{}'::jsonb,read_at timestamptz,push_status text not null default 'pending' check(push_status in('pending','sent','failed','no_subscription')),push_attempts integer not null default 0,next_push_at timestamptz not null default now(),last_push_error text,sent_at timestamptz,created_at timestamptz not null default now(),unique(user_id,event_key));
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);
create index if not exists notifications_push_queue_idx on public.notifications(push_status,next_push_at) where push_status in('pending','failed');
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.notifications from anon;
revoke insert,delete,update on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;

create table if not exists public.push_server_config(id smallint primary key default 1 check(id=1),vapid_public_key text,vapid_private_key text,vapid_subject text not null default 'https://flavavisio.github.io/condominio/',cron_secret text,updated_at timestamptz not null default now());
alter table public.push_server_config enable row level security;
revoke all on public.push_server_config from public,anon,authenticated;
grant select,insert,update on public.push_server_config to service_role;
insert into public.push_server_config(id,vapid_subject,cron_secret) values(1,'https://flavavisio.github.io/condominio/',encode(gen_random_bytes(32),'hex')) on conflict(id) do nothing;

create or replace function private.queue_condo_notification(p_condominium_id uuid,p_event_key text,p_kind text,p_title text,p_body text,p_url text default null,p_severity text default 'info',p_payload jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path=''
as $$ declare v_company uuid; n integer; begin select company_id into v_company from public.condominiums where id=p_condominium_id; if v_company is null then return 0; end if; with recipients as (select a.user_id from public.condominium_staff_assignments a where a.condominium_id=p_condominium_id and a.status='active' union select cm.user_id from public.company_members cm where cm.company_id=v_company and cm.status='active' and cm.role='admin' and private.has_active_company_admin_license(v_company,cm.user_id)), ins as (insert into public.notifications(user_id,company_id,condominium_id,event_key,kind,severity,title,body,url,payload) select r.user_id,v_company,p_condominium_id,p_event_key,p_kind,p_severity,p_title,p_body,p_url,coalesce(p_payload,'{}'::jsonb) from recipients r on conflict(user_id,event_key) do nothing returning 1) select count(*) into n from ins; return n; end; $$;
revoke all on function private.queue_condo_notification(uuid,text,text,text,text,text,text,jsonb) from public,anon,authenticated;

create or replace function private.issue_alert_trigger() returns trigger language plpgsql security definer set search_path=''
as $$ begin if new.priority in('high','urgent') and new.status not in('resolved','closed') and (tg_op='INSERT' or old.priority is distinct from new.priority or old.status is distinct from new.status) then perform private.queue_condo_notification(new.condominium_id,'issue:'||new.id::text||':'||new.priority,'issue',case when new.priority='urgent' then 'Ocorrência urgente' else 'Ocorrência prioritária' end,new.title,'/?condo='||new.condominium_id::text||'&tab=issues',case when new.priority='urgent' then 'urgent' else 'warning' end,jsonb_build_object('issue_id',new.id,'priority',new.priority)); end if; return new; end; $$;
drop trigger if exists issues_push_alert on public.issues;
create trigger issues_push_alert after insert or update of priority,status on public.issues for each row execute function private.issue_alert_trigger();

create or replace function public.generate_scheduled_condo_alerts() returns integer language plpgsql security definer set search_path=''
as $$ declare r record; total integer:=0; n integer; begin for r in select id,condominium_id,title,next_date from public.obligations where active=true and next_date is not null and next_date<=current_date+7 loop n:=private.queue_condo_notification(r.condominium_id,'obligation:'||r.id::text||':'||r.next_date::text,'obligation',case when r.next_date<current_date then 'Obrigação vencida' else 'Obrigação a vencer' end,r.title||' · '||to_char(r.next_date,'DD/MM/YYYY'),'/?condo='||r.condominium_id::text||'&tab=obligations',case when r.next_date<current_date then 'urgent' else 'warning' end,jsonb_build_object('obligation_id',r.id,'next_date',r.next_date)); total:=total+coalesce(n,0); end loop; for r in select id,condominium_id,title,next_service_on from public.periodic_services where active=true and next_service_on is not null and next_service_on<=current_date+1 loop n:=private.queue_condo_notification(r.condominium_id,'service:'||r.id::text||':'||r.next_service_on::text,'service','Serviço periódico',r.title||' · '||to_char(r.next_service_on,'DD/MM/YYYY'),'/?condo='||r.condominium_id::text||'&tab=services','info',jsonb_build_object('service_id',r.id,'next_service_on',r.next_service_on)); total:=total+coalesce(n,0); end loop; for r in select id,condominium_id,title,scheduled_for from public.maintenance where scheduled_for is not null and scheduled_for between now() and now()+interval '24 hours' and coalesce(status,'') not in('completed','cancelled') loop n:=private.queue_condo_notification(r.condominium_id,'maintenance:'||r.id::text||':'||date_trunc('hour',r.scheduled_for)::text,'maintenance','Manutenção agendada',r.title||' · '||to_char(r.scheduled_for at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),'/?condo='||r.condominium_id::text||'&tab=maintenance','info',jsonb_build_object('maintenance_id',r.id,'scheduled_for',r.scheduled_for)); total:=total+coalesce(n,0); end loop; return total; end; $$;
revoke all on function public.generate_scheduled_condo_alerts() from public,anon,authenticated;

do $$ declare j record; begin for j in select jobid from cron.job where jobname in('condominio-license-expiry','condominio-alert-generator','condominio-push-dispatch') loop perform cron.unschedule(j.jobid); end loop; end $$;
select cron.schedule('condominio-license-expiry','10 0 * * *','select public.expire_company_admin_licenses();');
select cron.schedule('condominio-alert-generator','*/15 * * * *','select public.generate_scheduled_condo_alerts();');
select cron.schedule('condominio-push-dispatch','*/2 * * * *',$$select net.http_post(url:='https://pvfrlirjdauncoudkomu.supabase.co/functions/v1/push-dispatch',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select cron_secret from public.push_server_config where id=1)),body:='{}'::jsonb);$$);
