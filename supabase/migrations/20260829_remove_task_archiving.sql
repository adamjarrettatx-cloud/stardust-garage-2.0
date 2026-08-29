-- ---------------------------------------------------------------------------
-- Remove task archiving from the progress tracker entirely.
--
-- Archiving was never used. Verified before writing this migration:
--   project_tasks where archived        -> 0 rows
--   project_tasks where archived_at is not null -> 0 rows
--   project_task_activity where action in ('archived','unarchived') -> 0 rows
-- So nothing is lost and the activity CHECK can be tightened without
-- orphaning any historical audit rows.
--
-- ORDER MATTERS. Both trigger functions read NEW.archived / OLD.archived.
-- plpgsql bodies are resolved at execution time, so dropping the columns first
-- would leave two triggers that raise on the next UPDATE of any task. The
-- functions are therefore replaced BEFORE the columns go away.
-- ---------------------------------------------------------------------------

-- 1) Bookkeeping trigger: drop the archived_at mirroring block, keep the
--    updated_at and completed_at behaviour byte-for-byte.
create or replace function public.project_tasks_bookkeeping()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();

    -- completed_at tracks entry into / exit from the 'done' state.
    if new.status = 'done' and coalesce(old.status, '') <> 'done' then
      new.completed_at := now();
    elsif new.status <> 'done' then
      new.completed_at := null;
    end if;
  end if;
  return new;
end; $function$;

-- 2) Activity trigger: drop the archived/unarchived logging block. Every other
--    logged transition is unchanged.
create or replace function public.project_tasks_log_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if new.status is distinct from old.status then
    insert into public.project_task_activity(task_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'status_changed',
        jsonb_build_object('from', old.status, 'to', new.status));
    if new.status = 'done' and old.status <> 'done' then
      insert into public.project_task_activity(task_id, actor_id, action, detail)
        values (new.id, auth.uid(), 'completed', '{}'::jsonb);
    end if;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.project_task_activity(task_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'assigned',
        jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.project_task_activity(task_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'reprioritized',
        jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.project_task_activity(task_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'due_changed',
        jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;

  if new.update_cadence_days is distinct from old.update_cadence_days
     or new.next_update_due is distinct from old.next_update_due then
    insert into public.project_task_activity(task_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'cadence_changed', jsonb_build_object(
        'cadence_from', old.update_cadence_days, 'cadence_to', new.update_cadence_days,
        'next_from', old.next_update_due, 'next_to', new.next_update_due));
  end if;

  if new.percent_complete is distinct from old.percent_complete then
    insert into public.project_task_activity(task_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'percent_changed',
        jsonb_build_object('from', old.percent_complete, 'to', new.percent_complete));
  end if;

  return new;
end; $function$;

-- 3) Now the columns and their index can go.
drop index if exists public.project_tasks_archived_idx;

alter table public.project_tasks
  drop column if exists archived,
  drop column if exists archived_at;

-- 4) Retire the two activity actions. Safe only because no rows use them.
alter table public.project_task_activity
  drop constraint if exists project_task_activity_action_check;

alter table public.project_task_activity
  add constraint project_task_activity_action_check check (action in (
    'created', 'status_changed', 'assigned', 'reprioritized',
    'due_changed', 'cadence_changed', 'percent_changed',
    'completed', 'update_posted', 'edited'
  ));
