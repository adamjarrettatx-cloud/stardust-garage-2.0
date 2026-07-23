-- =========================================================
-- Progress Tracker (internal project management) — MVP
--
-- Replaces the free-form department spreadsheet with an accountability
-- workflow: normalized tasks, chronological progress updates, and an
-- immutable activity log that makes stale work and missing updates obvious.
--
-- This migration is PURELY ADDITIVE:
--   * creates three new tables (project_tasks, project_task_updates,
--     project_task_activity)
--   * reuses the existing public.is_admin() / public.is_team() definers
--     (server-controlled team_members table, NOT user_metadata — Supabase
--     advisor 0015)
--   * adds a can_read_task() helper for comment/activity visibility
--   * adds one SECURITY DEFINER RPC (post_task_update) for the constrained
--     team-contributor write path
--   * adds triggers that keep bookkeeping columns fresh and write the
--     activity log
--   * adds explicit RLS on all three tables — NO public access
-- It does NOT alter or drop any existing column, table, policy, or function.
--
-- Security model (consistent with documents_hub / capacity_counter):
--   * is_admin()/is_team() read from team_members, not user_metadata.
--   * Team contributors NEVER get a broad UPDATE grant. Their only mutation
--     path is post_task_update(), a SECURITY DEFINER RPC that re-checks
--     membership + per-row visibility and only ever touches status/percent +
--     appends an update. Everything else (create, assign, reprioritise, due
--     dates, cadence, archive, complete) is admin-only via RLS.
--   * Hard DELETE has NO policy on any table => denied for every non
--     service-role caller (including admins). Owner-only hard delete happens
--     server-side with the service-role client after requireOwner(); the
--     normal lifecycle end-state is archive, which admins can do.
--   * project_task_activity has NO client INSERT/UPDATE/DELETE policy. It is
--     written ONLY by SECURITY DEFINER triggers, so the audit trail cannot be
--     forged or edited by any client — it is immutable except to service_role.
-- =========================================================

-- ---------------------------------------------------------------------------
-- Tasks. One row per deliverable, replacing a spreadsheet row.
-- ---------------------------------------------------------------------------
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),

  title text not null check (length(trim(title)) > 0),
  -- Department/Area. Canonical slugs mapped to labels in lib/progress.js.
  department text not null check (department in (
    'marketing', 'memberships', 'weekend_programming', 'weekday_programming',
    'app', 'data', 'supplies_inventory', 'products', 'awareness',
    'management', 'legal'
  )),
  description text,

  -- Assignee is an existing team profile (team_members.id). Nullable so a task
  -- can be triaged before it is assigned. RLS scopes team reads/writes to the
  -- team member whose team_members.user_id = auth.uid().
  assignee_id uuid references public.team_members(id) on delete set null,

  status text not null default 'not_started' check (status in (
    'not_started', 'in_progress', 'blocked', 'waiting', 'done'
  )),
  priority text not null default 'medium' check (priority in (
    'low', 'medium', 'high', 'urgent'
  )),

  due_date date,

  -- Expected update cadence. update_cadence_days is the SLA the assignee agreed
  -- to (e.g. 7 = "post something weekly"); next_update_due is the concrete date
  -- the next update is expected by. Either/both may be null (no cadence set).
  -- next_update_due is advanced by post_task_update() when a cadence is set.
  update_cadence_days integer check (update_cadence_days is null or update_cadence_days > 0),
  next_update_due date,

  percent_complete integer not null default 0
    check (percent_complete >= 0 and percent_complete <= 100),

  archived boolean not null default false,
  archived_at timestamptz,
  completed_at timestamptz,

  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_tasks_department_idx on public.project_tasks(department);
create index if not exists project_tasks_status_idx      on public.project_tasks(status);
create index if not exists project_tasks_assignee_idx     on public.project_tasks(assignee_id);
create index if not exists project_tasks_priority_idx     on public.project_tasks(priority);
create index if not exists project_tasks_due_idx          on public.project_tasks(due_date);
create index if not exists project_tasks_next_update_idx  on public.project_tasks(next_update_due);
create index if not exists project_tasks_archived_idx     on public.project_tasks(archived);
create index if not exists project_tasks_created_at_idx   on public.project_tasks(created_at desc);

-- ---------------------------------------------------------------------------
-- Updates / comments. Chronological thread. Each update optionally captures
-- the status/percent change that accompanied it, so "what changed and when"
-- reads straight off the thread. "Post update" is the primary team action.
-- ---------------------------------------------------------------------------
create table if not exists public.project_task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,

  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  body text not null check (length(trim(body)) > 0),

  -- Optional status/percent transition captured with this update (null when the
  -- update was a plain comment with no state change).
  status_from text,
  status_to   text,
  percent_from integer,
  percent_to   integer,

  created_at timestamptz not null default now()
);

create index if not exists project_task_updates_task_idx
  on public.project_task_updates(task_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Activity log. Immutable audit trail written ONLY by triggers below.
-- ---------------------------------------------------------------------------
create table if not exists public.project_task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,

  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'created', 'status_changed', 'assigned', 'reprioritized',
    'due_changed', 'cadence_changed', 'percent_changed',
    'archived', 'unarchived', 'completed', 'update_posted', 'edited'
  )),
  -- Structured before/after payload, e.g. {"from":"not_started","to":"blocked"}.
  detail jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists project_task_activity_task_idx
  on public.project_task_activity(task_id, created_at desc);
create index if not exists project_task_activity_action_idx
  on public.project_task_activity(action);

-- ===========================================================================
-- Visibility helper. SECURITY DEFINER so comment/activity SELECT policies can
-- ask "may the current user see this task?" without re-implementing the row
-- predicate (and without leaking rows through the join).
-- ===========================================================================
create or replace function public.can_read_task(p_task_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth as $$
  select public.is_admin() or exists (
    select 1 from public.project_tasks t
    where t.id = p_task_id
      and public.is_team()
      and (
        t.created_by = auth.uid()
        or t.assignee_id in (
          select tm.id from public.team_members tm where tm.user_id = auth.uid()
        )
      )
  );
$$;
revoke all on function public.can_read_task(uuid) from public;
grant execute on function public.can_read_task(uuid) to authenticated;

-- ===========================================================================
-- Bookkeeping trigger: keep updated_at / completed_at / archived_at coherent
-- regardless of who writes (admin RLS update OR the RPC). Runs BEFORE so the
-- derived columns are stored, then the AFTER activity trigger reads them.
-- ===========================================================================
create or replace function public.project_tasks_bookkeeping()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();

    -- completed_at tracks entry into / exit from the 'done' state.
    if new.status = 'done' and coalesce(old.status, '') <> 'done' then
      new.completed_at := now();
    elsif new.status <> 'done' then
      new.completed_at := null;
    end if;

    -- archived_at mirrors the archived flag.
    if new.archived and not old.archived then
      new.archived_at := now();
    elsif not new.archived then
      new.archived_at := null;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists project_tasks_bookkeeping_trg on public.project_tasks;
create trigger project_tasks_bookkeeping_trg
before update on public.project_tasks
for each row execute function public.project_tasks_bookkeeping();

-- ===========================================================================
-- Activity triggers. SECURITY DEFINER so their INSERTs into the audit table
-- bypass RLS (the table has no client insert policy, keeping it unforgeable).
-- auth.uid() still resolves to the calling user inside a definer function.
-- ===========================================================================
create or replace function public.project_tasks_log_insert()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
begin
  insert into public.project_task_activity(task_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'created', jsonb_build_object(
      'title', new.title,
      'department', new.department,
      'status', new.status,
      'priority', new.priority
    ));
  return new;
end; $$;

drop trigger if exists project_tasks_log_insert_trg on public.project_tasks;
create trigger project_tasks_log_insert_trg
after insert on public.project_tasks
for each row execute function public.project_tasks_log_insert();

create or replace function public.project_tasks_log_update()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
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

  if new.archived is distinct from old.archived then
    insert into public.project_task_activity(task_id, actor_id, action,
      detail)
      values (new.id, auth.uid(), case when new.archived then 'archived' else 'unarchived' end, '{}'::jsonb);
  end if;

  return new;
end; $$;

drop trigger if exists project_tasks_log_update_trg on public.project_tasks;
create trigger project_tasks_log_update_trg
after update on public.project_tasks
for each row execute function public.project_tasks_log_update();

create or replace function public.project_task_updates_log()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
begin
  insert into public.project_task_activity(task_id, actor_id, action, detail)
    values (new.task_id, coalesce(new.author_id, auth.uid()), 'update_posted',
      jsonb_build_object(
        'status_from', new.status_from, 'status_to', new.status_to,
        'percent_from', new.percent_from, 'percent_to', new.percent_to));
  return new;
end; $$;

drop trigger if exists project_task_updates_log_trg on public.project_task_updates;
create trigger project_task_updates_log_trg
after insert on public.project_task_updates
for each row execute function public.project_task_updates_log();

-- ===========================================================================
-- Team contributor write path. The ONLY way a non-admin team member mutates a
-- task. SECURITY DEFINER + internal re-checks so a leaked JWT cannot escalate:
--   * must be a team member (is_team())
--   * must be allowed on THIS task (admin, assignee, or creator)
--   * may only set status (to a permitted state) and/or percent_complete
--   * always appends the update row (the primary team action)
-- Returns the updated task row as jsonb so the caller has authoritative state.
-- ===========================================================================
create or replace function public.post_task_update(
  p_task_id uuid,
  p_body text,
  p_status text default null,
  p_percent integer default null
)
returns public.project_tasks language plpgsql security definer
set search_path = public, auth as $$
declare
  t public.project_tasks;
  v_allowed boolean;
  v_status_from text;
  v_percent_from integer;
  v_new_status text;
  v_new_percent integer;
begin
  if not public.is_team() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Update body is required' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in
      ('not_started','in_progress','blocked','waiting','done') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then
    raise exception 'percent out of range' using errcode = '22023';
  end if;

  select * into t from public.project_tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  -- Per-row authorization: admin, the assignee, or the creator.
  v_allowed := public.is_admin()
    or t.created_by = auth.uid()
    or t.assignee_id in (select tm.id from public.team_members tm where tm.user_id = auth.uid());
  if not v_allowed then
    raise exception 'Not authorized for this task' using errcode = '42501';
  end if;

  v_status_from := t.status;
  v_percent_from := t.percent_complete;
  v_new_status := coalesce(p_status, t.status);
  v_new_percent := coalesce(p_percent, t.percent_complete);

  update public.project_tasks
    set status = v_new_status,
        percent_complete = v_new_percent,
        -- Advance the cadence clock: a fresh update resets the next-due date.
        next_update_due = case
          when update_cadence_days is not null
            then (now() at time zone 'utc')::date + update_cadence_days
          else next_update_due
        end
    where id = t.id
    returning * into t;

  insert into public.project_task_updates(
      task_id, author_id, body, status_from, status_to, percent_from, percent_to)
    values (
      t.id, auth.uid(), trim(p_body),
      case when v_new_status <> v_status_from then v_status_from else null end,
      case when v_new_status <> v_status_from then v_new_status else null end,
      case when v_new_percent <> v_percent_from then v_percent_from else null end,
      case when v_new_percent <> v_percent_from then v_new_percent else null end);

  return t;
end; $$;

revoke all on function public.post_task_update(uuid, text, text, integer) from public;
grant execute on function public.post_task_update(uuid, text, text, integer) to authenticated;

-- ===========================================================================
-- RLS. Nothing here is public. Team reads are scoped to tasks assigned to /
-- created by the caller; admins (general managers) see and manage everything.
-- ===========================================================================
alter table public.project_tasks         enable row level security;
alter table public.project_task_updates  enable row level security;
alter table public.project_task_activity enable row level security;

-- Tasks -------------------------------------------------------------------
drop policy if exists project_tasks_select on public.project_tasks;
drop policy if exists project_tasks_admin_insert on public.project_tasks;
drop policy if exists project_tasks_admin_update on public.project_tasks;
-- Read: admins see all; team members see only their own assigned/created tasks.
create policy project_tasks_select on public.project_tasks
  for select to authenticated using (
    public.is_admin()
    or (
      public.is_team() and (
        created_by = auth.uid()
        or assignee_id in (
          select tm.id from public.team_members tm where tm.user_id = auth.uid()
        )
      )
    )
  );
-- Create / broad edit / assign / archive / complete: admin only.
create policy project_tasks_admin_insert on public.project_tasks
  for insert to authenticated with check (public.is_admin());
create policy project_tasks_admin_update on public.project_tasks
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- NO delete policy: hard delete is owner-only via the service-role client.
-- NO team update policy: team writes go exclusively through post_task_update().

-- Updates / comments ------------------------------------------------------
drop policy if exists project_task_updates_select on public.project_task_updates;
drop policy if exists project_task_updates_admin_insert on public.project_task_updates;
create policy project_task_updates_select on public.project_task_updates
  for select to authenticated using (public.can_read_task(task_id));
-- Admins may post updates directly; team members post via post_task_update()
-- (SECURITY DEFINER, so it does not depend on this policy). author must be self.
create policy project_task_updates_admin_insert on public.project_task_updates
  for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid());
-- NO update/delete policy: the thread is append-only.

-- Activity ----------------------------------------------------------------
drop policy if exists project_task_activity_select on public.project_task_activity;
create policy project_task_activity_select on public.project_task_activity
  for select to authenticated using (public.can_read_task(task_id));
-- NO insert/update/delete policy: written only by SECURITY DEFINER triggers,
-- so the audit trail is immutable and unforgeable for every client.
