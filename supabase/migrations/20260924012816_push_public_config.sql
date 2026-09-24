create table if not exists public.push_public_config (
  id smallint primary key default 1 check (id=1),
  vapid_public_key text,
  updated_at timestamptz not null default now()
);
alter table public.push_public_config enable row level security;
drop policy if exists push_public_config_select on public.push_public_config;
create policy push_public_config_select on public.push_public_config for select to authenticated using (true);
revoke all on public.push_public_config from anon;
revoke insert,update,delete on public.push_public_config from authenticated;
grant select on public.push_public_config to authenticated;
grant select,insert,update on public.push_public_config to service_role;
