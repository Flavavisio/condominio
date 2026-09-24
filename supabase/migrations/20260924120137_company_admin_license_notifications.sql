create or replace function public.generate_company_admin_license_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  with due as (
    select
      l.id as license_id,
      l.company_id,
      l.user_id,
      l.billing_cycle,
      l.expires_on,
      (l.expires_on - current_date) as days_left
    from public.company_admin_licenses l
    join public.company_members cm
      on cm.company_id = l.company_id
     and cm.user_id = l.user_id
     and cm.role = 'admin'
     and cm.status = 'active'
    where l.status = 'active'
      and l.expires_on >= current_date
      and (l.expires_on - current_date) in (7,3,1,0)
  ), ins as (
    insert into public.notifications(
      user_id, company_id, condominium_id, event_key, kind, severity,
      title, body, url, payload
    )
    select
      d.user_id,
      d.company_id,
      null,
      'license:' || d.license_id::text || ':days:' || d.days_left::text,
      'license',
      case when d.days_left = 0 then 'urgent' else 'warning' end,
      case
        when d.days_left = 0 then 'A sua licença termina hoje'
        when d.days_left = 1 then 'A sua licença termina amanhã'
        else 'A sua licença termina em ' || d.days_left::text || ' dias'
      end,
      'Licença ' || case when d.billing_cycle = 'annual' then 'anual' else 'mensal' end ||
      ' válida até ' || to_char(d.expires_on,'DD/MM/YYYY') || '.',
      './',
      jsonb_build_object(
        'license_id', d.license_id,
        'billing_cycle', d.billing_cycle,
        'expires_on', d.expires_on,
        'days_left', d.days_left
      )
    from due d
    on conflict (user_id, event_key) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;

  return inserted_count;
end;
$$;

revoke all on function public.generate_company_admin_license_notifications() from public, anon, authenticated;

select cron.schedule(
  'condominio-license-reminders',
  '5 8 * * *',
  $$select public.generate_company_admin_license_notifications();$$
);
