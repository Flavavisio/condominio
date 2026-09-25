-- Assembly records and one immutable ballot per fraction.
create function private.can_manage_governance(target uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select private.can_manage_condo(target) and (private.is_super_admin() or exists (
 select 1 from public.company_members m join public.condominiums c on c.company_id=m.company_id
 where c.id=target and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('admin','manager')));
$$;
revoke all on function private.can_manage_governance(uuid) from public, anon;
grant execute on function private.can_manage_governance(uuid) to authenticated;

create table public.assemblies (
 id uuid primary key default gen_random_uuid(),
 condominium_id uuid not null references public.condominiums(id),
 title text not null check(length(trim(title)) between 1 and 200),
 scheduled_for timestamptz not null,
 location text not null check(length(trim(location)) between 1 and 500),
 agenda text not null check(length(trim(agenda)) between 1 and 20000),
 minutes text not null default '' check(length(minutes)<=100000),
 status text not null default 'draft' check(status in ('draft','scheduled','completed','cancelled')),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,condominium_id)
);
create table public.polls (
 id uuid primary key default gen_random_uuid(), condominium_id uuid not null references public.condominiums(id),
 assembly_id uuid,
 title text not null check(length(trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=20000),
 opens_at timestamptz not null, closes_at timestamptz not null check(closes_at>opens_at),
 status text not null default 'draft' check(status in ('draft','open','closed','cancelled')),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(assembly_id,condominium_id) references public.assemblies(id,condominium_id),
 unique(id,condominium_id)
);
create table public.poll_votes (
 id uuid primary key default gen_random_uuid(), poll_id uuid not null,
 condominium_id uuid not null references public.condominiums(id),
 fraction_id uuid not null references public.fractions(id), voter_id uuid not null default auth.uid() references auth.users(id),
 choice text not null check(choice in ('yes','no','abstain')),
 permillage numeric not null default 0 check(permillage>=0), created_at timestamptz not null default now(),
 foreign key(poll_id,condominium_id) references public.polls(id,condominium_id), unique(poll_id,fraction_id)
);
create index assemblies_condo_date on public.assemblies(condominium_id,scheduled_for);
create index polls_condo_date on public.polls(condominium_id,closes_at);
create index polls_assembly on public.polls(assembly_id,condominium_id);
create index poll_votes_condo on public.poll_votes(condominium_id);
create index poll_votes_fraction on public.poll_votes(fraction_id);
create index poll_votes_voter on public.poll_votes(voter_id);
create index assemblies_creator on public.assemblies(created_by);
create index polls_creator on public.polls(created_by);

create function private.governance_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
   new.created_by:=auth.uid(); new.created_at:=now();
 else
   if new.condominium_id<>old.condominium_id or new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then
     raise exception 'Não é possível alterar a origem deste registo.';
   end if;
   if TG_TABLE_NAME='polls' and old.status<>'draft' then
     if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
       raise exception 'Uma votação publicada não permite alterar a pergunta, datas ou assembleia.';
     end if;
     if new.status<>old.status and not (old.status='open' and new.status in ('closed','cancelled')) then
       raise exception 'Transição de estado inválida.';
     end if;
   end if;
 end if;
 new.updated_at:=now();
 return new;
end;
$$;
revoke all on function private.governance_guard() from public,anon;
create trigger assemblies_guard before insert or update on public.assemblies for each row execute function private.governance_guard();
create trigger polls_guard before insert or update on public.polls for each row execute function private.governance_guard();

-- Definer required to lock the poll against concurrent closing, validate ownership,
-- and snapshot the authoritative fraction weight. Not an exposed RPC.
create function private.validate_ballot() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.polls; weight numeric;
begin
 if auth.uid() is null then raise exception 'Sessão necessária.'; end if;
 select * into p from public.polls where id=new.poll_id for share;
 if not found or p.status<>'open' or now()<p.opens_at or now()>=p.closes_at then
   raise exception 'Esta votação não está aberta.';
 end if;
 select f.permillage into weight from public.fractions f
 where f.id=new.fraction_id and f.condominium_id=p.condominium_id and f.status='active'
 and exists(select 1 from public.condominium_members m where m.user_id=auth.uid()
 and m.fraction_id=f.id and m.condominium_id=f.condominium_id and m.status='active'
 and m.member_role in ('owner','representative'));
 if not found or not private.can_view_condo(p.condominium_id) then
   raise exception 'Sem autorização para votar por esta fração.';
 end if;
 new.condominium_id:=p.condominium_id; new.voter_id:=auth.uid();
 new.permillage:=coalesce(weight,0); new.created_at:=now();
 return new;
end;
$$;
revoke all on function private.validate_ballot() from public,anon,authenticated;
create trigger validate_ballot before insert on public.poll_votes for each row execute function private.validate_ballot();

alter table public.assemblies enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.assemblies, public.polls, public.poll_votes from anon,authenticated;
grant select,insert,update on public.assemblies,public.polls to authenticated;
grant select,insert on public.poll_votes to authenticated;
create policy assemblies_read on public.assemblies for select to authenticated using(private.can_manage_governance(condominium_id) or (status<>'draft' and private.can_view_condo(condominium_id)));
create policy assemblies_create on public.assemblies for insert to authenticated with check(private.can_manage_governance(condominium_id) and created_by=(select auth.uid()));
create policy assemblies_edit on public.assemblies for update to authenticated using(private.can_manage_governance(condominium_id)) with check(private.can_manage_governance(condominium_id));
create policy polls_read on public.polls for select to authenticated using(private.can_manage_governance(condominium_id) or (status<>'draft' and private.can_view_condo(condominium_id)));
create policy polls_create on public.polls for insert to authenticated with check(private.can_manage_governance(condominium_id) and created_by=(select auth.uid()));
create policy polls_edit on public.polls for update to authenticated using(private.can_manage_governance(condominium_id)) with check(private.can_manage_governance(condominium_id));
create policy ballots_read on public.poll_votes for select to authenticated using(private.can_view_condo(condominium_id) and (voter_id=(select auth.uid()) or private.can_manage_governance(condominium_id)));
create policy ballots_create on public.poll_votes for insert to authenticated with check(voter_id=(select auth.uid()) and private.can_view_condo(condominium_id));

-- Aggregates disclose no voter identity. Residents see results after closing.
create function private.governance_results(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.polls; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sessão necessária.'; end if;
 select * into p from public.polls where id=target;
 if not found or not private.can_view_condo(p.condominium_id) then raise exception 'Sem acesso à votação.'; end if;
 if not private.can_manage_governance(p.condominium_id) and (p.status not in ('closed','open') or (p.status='open' and now()<p.closes_at)) then
   return null;
 end if;
 select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) into result from
 (select choice,count(*) as votes,sum(permillage) as permillage from public.poll_votes where poll_id=target group by choice) t;
 return result;
end;
$$;
revoke all on function private.governance_results(uuid) from public,anon;
grant execute on function private.governance_results(uuid) to authenticated;
create function public.get_poll_results(target uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.governance_results(target);$$;
revoke all on function public.get_poll_results(uuid) from public,anon;
grant execute on function public.get_poll_results(uuid) to authenticated;
