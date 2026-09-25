-- Existing issues retain their current operational flow.
alter table public.issues
 add column approval_status text not null default 'approved' check(approval_status in ('pending','approved','rejected')),
 add column reviewed_by uuid references auth.users(id),
 add column reviewed_at timestamptz,
 add column review_note text not null default '' check(length(review_note)<=2000);
create index issues_approval_queue on public.issues(condominium_id,approval_status,created_at);
create index issues_reviewer on public.issues(reviewed_by);

-- All role assignments, including service-role writes, obey the same cap.
create function private.guard_fraction_membership() returns trigger language plpgsql security invoker set search_path='' as $$
declare total integer;
begin
 if new.fraction_id is not null and not exists(select 1 from public.fractions f where f.id=new.fraction_id and f.condominium_id=new.condominium_id) then
   raise exception 'A fração não pertence a este condomínio.';
 end if;
 if new.is_condominium_admin and new.fraction_id is null then raise exception 'O administrador deve estar associado a uma fração.'; end if;
 if auth.uid() is not null and ((TG_OP='INSERT' and new.is_condominium_admin) or (TG_OP='UPDATE' and (new.is_condominium_admin or old.is_condominium_admin))) and not private.can_manage_governance(new.condominium_id) then
   raise exception 'Só a gestora pode nomear administradores do condomínio.' using errcode='42501';
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
revoke all on function private.guard_fraction_membership() from public,anon,authenticated;
create trigger guard_fraction_membership before insert or update on public.condominium_members for each row execute function private.guard_fraction_membership();

create or replace function public.set_condominium_resident_admin(p_condominium_id uuid,p_user_id uuid,p_is_admin boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not private.can_manage_governance(p_condominium_id) then raise exception 'Sem permissões para gerir os administradores deste condomínio.' using errcode='42501'; end if;
 update public.condominium_members set is_condominium_admin=coalesce(p_is_admin,false)
 where condominium_id=p_condominium_id and user_id=p_user_id and status='active' and fraction_id is not null;
 if not found then raise exception 'O utilizador não tem uma fração ativa neste condomínio.'; end if;
end;
$$;
revoke all on function public.set_condominium_resident_admin(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_condominium_resident_admin(uuid,uuid,boolean) to authenticated;

create function private.guard_issue_approval() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
   if auth.uid() is not null then new.reporter_user_id:=auth.uid(); end if;
   if new.fraction_id is not null and not exists(select 1 from public.fractions f where f.id=new.fraction_id and f.condominium_id=new.condominium_id) then raise exception 'Fração inválida para este condomínio.'; end if;
   new.reviewed_by:=null; new.reviewed_at:=null; new.review_note:='';
   if private.can_manage_condo(new.condominium_id) or private.is_condominium_admin(new.condominium_id) then
     new.approval_status:='approved';
   else
     if new.fraction_id is null then
       select m.fraction_id into new.fraction_id from public.condominium_members m where m.condominium_id=new.condominium_id and m.user_id=auth.uid() and m.status='active' and m.fraction_id is not null order by m.created_at limit 1;
     end if;
     if not exists(select 1 from public.condominium_members m where m.condominium_id=new.condominium_id and m.fraction_id=new.fraction_id and m.user_id=auth.uid() and m.status='active') then raise exception 'É necessário um acesso ativo à fração para reportar uma ocorrência.'; end if;
     new.approval_status:='pending'; new.status:='open'; new.assigned_to:=null; new.supplier_id:=null; new.equipment_id:=null; new.maintenance_id:=null; new.scheduled_for:=null; new.resolved_at:=null;
   end if;
   return new;
 end if;
 if new.id<>old.id or new.condominium_id<>old.condominium_id or new.reporter_user_id is distinct from old.reporter_user_id or new.fraction_id is distinct from old.fraction_id or new.created_at<>old.created_at then raise exception 'Não é possível alterar a origem da ocorrência.'; end if;
 if old.approval_status='pending' then
   if not private.is_condominium_admin(old.condominium_id) then raise exception 'A aprovação compete ao administrador do condomínio.' using errcode='42501'; end if;
   if new.approval_status not in ('approved','rejected') then raise exception 'Escolha aprovar ou rejeitar.'; end if;
   if (to_jsonb(new)-array['approval_status','reviewed_by','reviewed_at','review_note','updated_at']) is distinct from (to_jsonb(old)-array['approval_status','reviewed_by','reviewed_at','review_note','updated_at']) then raise exception 'Na aprovação só pode registar a decisão e o motivo.'; end if;
   if new.approval_status='rejected' and length(trim(new.review_note))=0 then raise exception 'Indique o motivo da rejeição.'; end if;
   new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
 else
   if new.approval_status<>old.approval_status or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_note<>old.review_note then raise exception 'A decisão de aprovação já foi registada.'; end if;
   if old.approval_status<>'approved' or not private.can_manage_condo(old.condominium_id) then raise exception 'Só a gestora pode tratar ocorrências aprovadas.' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;
revoke all on function private.guard_issue_approval() from public,anon,authenticated;
create trigger issues_approval_guard before insert or update on public.issues for each row execute function private.guard_issue_approval();

drop policy issues_select on public.issues;
create policy issues_select on public.issues for select to authenticated using(
 (approval_status='approved' and ((visibility='public' and private.can_view_condo(condominium_id)) or reporter_user_id=(select auth.uid()) or private.can_manage_condo(condominium_id) or private.is_condominium_admin(condominium_id)))
 or (approval_status in ('pending','rejected') and private.can_view_condo(condominium_id) and (reporter_user_id=(select auth.uid()) or private.is_condominium_admin(condominium_id)))
);
drop policy issues_update on public.issues;
create policy issues_update on public.issues for update to authenticated
 using((approval_status='approved' and private.can_manage_condo(condominium_id)) or (approval_status='pending' and private.is_condominium_admin(condominium_id)))
 with check((approval_status='approved' and private.can_manage_condo(condominium_id)) or (approval_status in ('approved','rejected') and private.is_condominium_admin(condominium_id)));
drop policy issues_delete on public.issues;
create policy issues_delete on public.issues for delete to authenticated using(approval_status='approved' and private.can_manage_condo(condominium_id));

create function public.review_condominium_issue(p_issue_id uuid,p_approve boolean,p_note text default '') returns public.issues
language plpgsql security invoker set search_path='' as $$
declare result public.issues;
begin
 if auth.uid() is null then raise exception 'Sessão necessária.' using errcode='42501'; end if;
 update public.issues set approval_status=case when p_approve then 'approved' else 'rejected' end,review_note=coalesce(p_note,'')
 where id=p_issue_id and approval_status='pending' and private.is_condominium_admin(condominium_id) returning * into result;
 if not found then raise exception 'Ocorrência já revista ou sem permissão para aprovar.'; end if;
 return result;
end;
$$;
revoke all on function public.review_condominium_issue(uuid,boolean,text) from public,anon;
grant execute on function public.review_condominium_issue(uuid,boolean,text) to authenticated;

-- Pending reports never reach the management company's notifications.
create or replace function private.issue_alert_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.approval_status<>'approved' then return new; end if;
 if TG_OP='INSERT' or (TG_OP='UPDATE' and old.approval_status<>'approved') then
   if new.status not in ('resolved','closed') then
     perform private.queue_condo_notification(new.condominium_id,'issue:'||new.id::text||':created','issue',
       case when new.priority='urgent' then 'Nova ocorrência urgente' when new.priority='high' then 'Nova ocorrência prioritária' else 'Nova ocorrência' end,
       new.title,'/?condo='||new.condominium_id::text||'&tab=issues',case when new.priority='urgent' then 'urgent' when new.priority='high' then 'warning' else 'info' end,
       jsonb_build_object('issue_id',new.id,'priority',new.priority,'status',new.status));
   end if;
 elsif new.status not in ('resolved','closed') and new.priority in ('high','urgent') and old.priority is distinct from new.priority then
   perform private.queue_condo_notification(new.condominium_id,'issue:'||new.id::text||':priority:'||new.priority,'issue',
     case when new.priority='urgent' then 'Ocorrência passou a urgente' else 'Prioridade da ocorrência aumentou' end,
     new.title,'/?condo='||new.condominium_id::text||'&tab=issues',case when new.priority='urgent' then 'urgent' else 'warning' end,
     jsonb_build_object('issue_id',new.id,'priority',new.priority,'status',new.status));
 end if;
 return new;
end;
$$;
revoke all on function private.issue_alert_trigger() from public,anon,authenticated;
drop trigger issues_push_alert on public.issues;
create trigger issues_push_alert after insert or update of priority,status,approval_status on public.issues for each row execute function private.issue_alert_trigger();
