do $$
declare
  t text;
  tables text[] := array[
    'profiles','companies','company_members','condominiums','fractions','condominium_members','issues',
    'notices','notice_reads','documents','suppliers','equipment','maintenance','obligations',
    'obligation_checklist_items','obligation_inspections'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all privileges on table public.%I from anon', t);
    execute format('revoke all privileges on table public.%I from authenticated', t);
  end loop;
end $$;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.company_members to authenticated;
grant select, insert, update, delete on public.condominiums to authenticated;
grant select, insert, update, delete on public.fractions to authenticated;
grant select, insert, update, delete on public.condominium_members to authenticated;
grant select, insert, update, delete on public.issues to authenticated;
grant select, insert, update, delete on public.notices to authenticated;
grant select, insert, update, delete on public.notice_reads to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.equipment to authenticated;
grant select, insert, update, delete on public.maintenance to authenticated;
grant select, insert, update, delete on public.obligations to authenticated;
grant select, insert, update, delete on public.obligation_checklist_items to authenticated;
grant select, insert, update, delete on public.obligation_inspections to authenticated;
