create or replace function private.guard_fraction_membership() returns trigger language plpgsql security invoker set search_path='' as $$
declare total integer;
begin
 if new.fraction_id is not null and not exists(select 1 from public.fractions f where f.id=new.fraction_id and f.condominium_id=new.condominium_id) then
   raise exception 'A fração não pertence a este condomínio.';
 end if;
 if new.is_condominium_admin and new.fraction_id is null then raise exception 'O administrador deve estar associado a uma fração.'; end if;
 -- Branch before preparing the authorization query: service-role requests have
 -- no auth.uid() and deliberately have no access to the private schema.
 if auth.uid() is not null then
   if (TG_OP='INSERT' and new.is_condominium_admin) or
      (TG_OP='UPDATE' and (new.is_condominium_admin or old.is_condominium_admin)) then
     if not private.can_manage_governance(new.condominium_id) then
       raise exception 'Só a gestora pode nomear administradores do condomínio.' using errcode='42501';
     end if;
   end if;
 end if;
 if new.is_condominium_admin and new.status='active' then
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.condominium_id::text,917));
   select count(distinct user_id) into total from public.condominium_members m
   where m.condominium_id=new.condominium_id and m.status='active' and m.is_condominium_admin and m.user_id<>new.user_id;
   if total>=2 then raise exception 'Este condomínio já tem dois administradores. Retire um antes de nomear outro.'; end if;
 end if;
 return new;
end;
$$;
