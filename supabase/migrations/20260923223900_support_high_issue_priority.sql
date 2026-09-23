alter table public.issues drop constraint if exists issues_priority_check;
alter table public.issues add constraint issues_priority_check check (priority in ('low','normal','high','urgent'));
