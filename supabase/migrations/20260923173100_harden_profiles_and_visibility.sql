revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

create or replace function private.protect_profile_super_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin then
    if current_user not in ('postgres','service_role','supabase_admin') then
      raise exception 'is_super_admin cannot be changed by client roles';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_super_admin on public.profiles;
create trigger profiles_protect_super_admin
before update on public.profiles
for each row execute function private.protect_profile_super_admin();

create or replace function private.can_view_managed_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or target_user_id = (select auth.uid())
      or exists (
        select 1
        from public.condominium_members target_member
        join public.condominiums c on c.id = target_member.condominium_id
        join public.company_members me on me.company_id = c.company_id
        where target_member.user_id = target_user_id
          and me.user_id = (select auth.uid())
          and me.status = 'active'
          and me.role in ('admin','manager','staff')
      )
      or exists (
        select 1
        from public.company_members target_member
        join public.company_members me on me.company_id = target_member.company_id
        where target_member.user_id = target_user_id
          and me.user_id = (select auth.uid())
          and me.status = 'active'
          and me.role in ('admin','manager')
      );
$$;

revoke execute on function private.can_view_managed_profile(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_view_managed_profile(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using ((select private.can_view_managed_profile(profiles.user_id)));
