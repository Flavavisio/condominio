alter table public.companies add column billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','annual'));

create function public.issue_automatic_company_license(p_company_id uuid,p_user_id uuid,p_billing_cycle text,p_plan_id text,p_extra_packs integer default 0,p_notes text default null)
returns public.company_admin_licenses language plpgsql security invoker set search_path='' as $$
declare v public.company_admin_licenses;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 v:=public.issue_planned_company_license(p_company_id,p_user_id,p_billing_cycle,current_date,p_plan_id,p_notes,p_extra_packs);
 update public.companies set contract_start=v.starts_on,contract_end=v.expires_on,billing_cycle=v.billing_cycle where id=v.company_id;
 return v;
end $$;

create function public.manage_automatic_company_license(p_license_id uuid,p_action text,p_billing_cycle text,p_plan_id text,p_extra_packs integer default 0,p_notes text default null)
returns public.company_admin_licenses language plpgsql security invoker set search_path='' as $$
declare v public.company_admin_licenses; result public.company_admin_licenses; start_date date; end_date date; period_start date;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 if p_action is null or p_action not in ('edit','renew','reactivate') or p_billing_cycle is null or p_billing_cycle not in ('monthly','annual') then raise exception 'Operação ou período inválido.';end if;
 select * into v from public.company_admin_licenses where id=p_license_id for update;
 if not found then raise exception 'Licença não encontrada.';end if;
 if p_action in ('renew','reactivate') and exists(select 1 from public.company_admin_licenses where company_id=v.company_id and user_id=v.user_id and id<>v.id and status='active' and expires_on>=current_date) then raise exception 'Já existe outra licença ativa para este administrador.';end if;
 start_date:=v.starts_on;end_date:=v.expires_on;
 if p_action='renew' then
   period_start:=case when v.status='active' and v.expires_on>=current_date then v.expires_on+1 else current_date end;
   start_date:=case when v.status='active' and v.expires_on>=current_date then v.starts_on else current_date end;
   end_date:=(period_start+case when p_billing_cycle='annual' then interval '1 year' else interval '1 month' end-interval '1 day')::date;
 elsif p_action='reactivate' and (v.expires_on<current_date or v.billing_cycle<>p_billing_cycle or v.status='cancelled') then
   start_date:=current_date;
   end_date:=(start_date+case when p_billing_cycle='annual' then interval '1 year' else interval '1 month' end-interval '1 day')::date;
 elsif p_action='edit' and v.billing_cycle<>p_billing_cycle then
   end_date:=(start_date+case when p_billing_cycle='annual' then interval '1 year' else interval '1 month' end-interval '1 day')::date;
 end if;
 result:=public.update_planned_company_license(v.id,p_billing_cycle,start_date,end_date,p_plan_id,p_notes,p_extra_packs);
 if p_action in ('renew','reactivate') then
   update public.company_admin_licenses set status='active' where id=v.id returning * into result;
 end if;
 update public.companies set contract_start=result.starts_on,contract_end=result.expires_on,billing_cycle=result.billing_cycle where id=v.company_id;
 return result;
end $$;

create function public.configure_company_license_plan(p_company_id uuid,p_plan_id text,p_extra_packs integer,p_billing_cycle text)
returns void language plpgsql security invoker set search_path='' as $$
declare l public.company_admin_licenses;
begin
 if not private.is_super_admin() then raise exception 'Sem permissões.' using errcode='42501';end if;
 if p_billing_cycle is null or p_billing_cycle not in ('monthly','annual') then raise exception 'Período inválido.';end if;
 perform public.set_company_license_plan(p_company_id,p_plan_id,p_extra_packs);
 for l in select * from public.company_admin_licenses where company_id=p_company_id and status='active' order by created_at loop
   perform public.manage_automatic_company_license(l.id,'edit',p_billing_cycle,p_plan_id,p_extra_packs,l.notes);
 end loop;
 update public.companies set billing_cycle=p_billing_cycle where id=p_company_id;
end $$;

revoke all on function public.issue_automatic_company_license(uuid,uuid,text,text,integer,text),public.manage_automatic_company_license(uuid,text,text,text,integer,text),public.configure_company_license_plan(uuid,text,integer,text) from public,anon;
grant execute on function public.issue_automatic_company_license(uuid,uuid,text,text,integer,text),public.manage_automatic_company_license(uuid,text,text,text,integer,text),public.configure_company_license_plan(uuid,text,integer,text) to authenticated;

-- The existing cron job runs as postgres. No client can invoke this generator.
create or replace function public.generate_company_admin_license_notifications()
returns integer language plpgsql security invoker set search_path='' as $$
declare inserted_count integer;
begin
 with due as (
   select l.*,coalesce(nullif(c.label,''),c.name) company_name,l.expires_on-current_date days_left
   from public.company_admin_licenses l join public.companies c on c.id=l.company_id
   where l.status in ('active','expired') and (l.expires_on-current_date in (7,3,1,0) or l.expires_on<current_date)
   and not exists(select 1 from public.company_admin_licenses newer where newer.company_id=l.company_id and newer.user_id=l.user_id and newer.created_at>l.created_at)
 ), recipients as (
   select d.id,p.user_id from due d cross join public.profiles p where p.is_super_admin
   union select d.id,cm.user_id from due d join public.company_members cm on cm.company_id=d.company_id and cm.role='admin' and cm.status='active'
 ), inserted as (
   insert into public.notifications(user_id,company_id,event_key,kind,severity,title,body,url,payload)
   select r.user_id,d.company_id,'license:'||d.id||':expiry:'||d.expires_on||':'||case when days_left<0 then 'expired' else days_left::text end,
   'license',case when days_left<=0 then 'urgent' else 'warning' end,
   case when days_left<0 then 'Licença expirada' when days_left=0 then 'Licença termina hoje' else 'Licença termina em '||days_left||' dias' end,
   d.company_name||' · Licença '||case when billing_cycle='annual' then 'anual' else 'mensal' end||' · validade até '||to_char(expires_on,'DD/MM/YYYY')||'.',
   './app.html',jsonb_build_object('license_id',d.id,'expires_on',d.expires_on,'days_left',d.days_left)
   from due d join recipients r on r.id=d.id on conflict(user_id,event_key) do nothing returning 1
 ) select count(*) into inserted_count from inserted;
 return inserted_count;
end $$;
revoke all on function public.generate_company_admin_license_notifications() from public,anon,authenticated;
select cron.schedule('condominio-license-reminders','5 * * * *','select public.generate_company_admin_license_notifications();');
