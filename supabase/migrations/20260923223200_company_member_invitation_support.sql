create index if not exists company_members_company_user_status_idx on public.company_members(company_id, user_id, status);
create index if not exists condominium_members_condominium_user_status_idx on public.condominium_members(condominium_id, user_id, status);
