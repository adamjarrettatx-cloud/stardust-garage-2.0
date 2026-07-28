-- =========================================================
-- Team member department tags — task visibility scoping
--
-- Reuses the existing task department vocabulary as "tags" on team member
-- accounts, so a person's Tasks page shows the departments they own plus
-- anything assigned to or created by them. The business owner
-- (adam@sdgatx.com, per public.is_owner()) is never scoped.
--
-- WHY: "admin" previously doubled as both "has backend panel access" and
-- "sees every task". Those two ideas are now decoupled:
--   * owner            → unrestricted task visibility, no tag filtering ever.
--   * role = 'admin'   → keeps full panel access AND full task MANAGEMENT
--                        (create / edit any task / assign to anyone), but for
--                        personal task browsing and posting updates they are
--                        tag-scoped exactly like a team-role member.
--   * role = 'team'    → no panel access (unchanged), tag-scoped visibility.
--
-- SCOPE: this migration only touches the SELECT-side predicate and the
-- constrained team write RPC. project_tasks_admin_insert and
-- project_tasks_admin_update are deliberately LEFT UNTOUCHED at is_admin(),
-- so admin task management capability is unchanged.
--
-- Objects changed:
--   1. public.team_members            — new `departments text[]` column + CHECK
--   2. public.can_read_task(uuid)     — CREATE OR REPLACE (policies depend on it)
--   3. project_tasks_select policy    — now delegates to can_read_task(id)
--   4. public.post_task_update(...)   — per-row check delegates to can_read_task()
--   5. team_members_departments_gin   — supporting index
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. Department tags on team member accounts. Empty array = no departments,
--    which still leaves assignee/creator visibility intact.
-- ---------------------------------------------------------------------------
alter table public.team_members
  add column if not exists departments text[] not null default '{}'::text[];

-- Mirrors the project_tasks.department CHECK constraint exactly. Keep both in
-- sync with DEPARTMENTS in lib/progress.js.
alter table public.team_members
  drop constraint if exists team_members_departments_check;

alter table public.team_members
  add constraint team_members_departments_check check (
    departments <@ array[
      'marketing', 'memberships', 'weekend_programming', 'weekday_programming',
      'app', 'data', 'supplies_inventory', 'products', 'awareness',
      'management', 'legal'
    ]::text[]
  );

-- The table is small, but the department-match clause below unnests this column
-- on every task read, so the GIN index is cheap insurance.
create index if not exists team_members_departments_gin
  on public.team_members using gin (departments);

-- ---------------------------------------------------------------------------
-- 2. Central visibility predicate. CREATE OR REPLACE (never dropped) because
--    the project_task_updates / project_task_activity SELECT policies and the
--    project_tasks_select policy all depend on it.
--
--    Changes vs. 20260723_progress_tracker.sql:
--      * the blanket bypass is now is_owner() instead of is_admin(), so a
--        non-owner admin is scoped like everyone else for reads;
--      * adds a department-match clause against team_members.departments.
--    Signature, volatility, SECURITY DEFINER and search_path are unchanged,
--    as are the is_team() semantics (role in ('admin','team')).
-- ---------------------------------------------------------------------------
create or replace function public.can_read_task(p_task_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth as $$
  select public.is_owner() or exists (
    select 1 from public.project_tasks t
    where t.id = p_task_id
      and public.is_team()
      and (
        t.created_by = (select auth.uid())
        or t.assignee_id in (
          select tm.id from public.team_members tm where tm.user_id = (select auth.uid())
        )
        or t.department = any (
          select unnest(coalesce(tm.departments, '{}'::text[]))
          from public.team_members tm where tm.user_id = (select auth.uid())
        )
      )
  );
$$;
revoke all on function public.can_read_task(uuid) from public;
grant execute on function public.can_read_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Task reads now delegate to can_read_task() so the predicate lives in
--    exactly one place. Replaces the inlined copy from
--    20260724_progress_tracker_advisor_fixes.sql.
--
--    NOT TOUCHED (intentionally): project_tasks_admin_insert and
--    project_tasks_admin_update remain is_admin()-gated. Tag scoping is a
--    visibility change, not a permissions change.
-- ---------------------------------------------------------------------------
drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks
  for select to authenticated using (public.can_read_task(id));

-- ---------------------------------------------------------------------------
-- 4. post_task_update(): the per-row authorization check reuses the same
--    central predicate, so posting an update follows visibility exactly. The
--    initial is_team() gate on who may call the RPC at all is unchanged, as is
--    every other line of the function.
-- ---------------------------------------------------------------------------
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

  -- Per-row authorization: owner, the assignee, the creator, or a department tag
  -- match. Same predicate as project_tasks_select.
  v_allowed := public.can_read_task(t.id);
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

revoke execute on function public.post_task_update(uuid, text, text, integer) from public, anon;
grant  execute on function public.post_task_update(uuid, text, text, integer) to authenticated;
