revoke execute on function public.activate_company_user(uuid,uuid,text) from public, anon;
grant execute on function public.activate_company_user(uuid,uuid,text) to authenticated;

revoke execute on function public.can_manage_condo_finance(uuid) from public, anon;
grant execute on function public.can_manage_condo_finance(uuid) to authenticated;

revoke execute on function public.create_bulk_fraction_charges(uuid,text,integer,integer,text,date,text,numeric) from public, anon;
grant execute on function public.create_bulk_fraction_charges(uuid,text,integer,integer,text,date,text,numeric) to authenticated;

revoke execute on function public.list_company_users(uuid) from public, anon;
grant execute on function public.list_company_users(uuid) to authenticated;

revoke execute on function public.list_pending_users() from public, anon;
grant execute on function public.list_pending_users() to authenticated;

revoke all on function public.payment_allocation_refresh_trigger() from public, anon, authenticated;
revoke all on function public.refresh_charge_status(uuid) from public, anon, authenticated;

revoke execute on function public.register_fraction_payment(uuid,uuid,date,numeric,text,text,text,boolean) from public, anon;
grant execute on function public.register_fraction_payment(uuid,uuid,date,numeric,text,text,text,boolean) to authenticated;

revoke execute on function public.set_company_user_condominiums(uuid,uuid,uuid[]) from public, anon;
grant execute on function public.set_company_user_condominiums(uuid,uuid,uuid[]) to authenticated;

revoke execute on function public.set_condominium_resident_admin(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_condominium_resident_admin(uuid,uuid,boolean) to authenticated;
