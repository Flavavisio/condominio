create or replace function private.issue_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('resolved','closed') then
      perform private.queue_condo_notification(
        new.condominium_id,
        'issue:' || new.id::text || ':created',
        'issue',
        case
          when new.priority = 'urgent' then 'Nova ocorrência urgente'
          when new.priority = 'high' then 'Nova ocorrência prioritária'
          else 'Nova ocorrência'
        end,
        new.title,
        '/?condo=' || new.condominium_id::text || '&tab=issues',
        case
          when new.priority = 'urgent' then 'urgent'
          when new.priority = 'high' then 'warning'
          else 'info'
        end,
        jsonb_build_object('issue_id',new.id,'priority',new.priority,'status',new.status)
      );
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status not in ('resolved','closed')
     and new.priority in ('high','urgent')
     and (old.priority is distinct from new.priority) then
    perform private.queue_condo_notification(
      new.condominium_id,
      'issue:' || new.id::text || ':priority:' || new.priority,
      'issue',
      case when new.priority='urgent' then 'Ocorrência passou a urgente' else 'Prioridade da ocorrência aumentou' end,
      new.title,
      '/?condo=' || new.condominium_id::text || '&tab=issues',
      case when new.priority='urgent' then 'urgent' else 'warning' end,
      jsonb_build_object('issue_id',new.id,'priority',new.priority,'status',new.status)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.issue_alert_trigger() from public, anon, authenticated;
