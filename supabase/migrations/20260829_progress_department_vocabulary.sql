-- =========================================================
-- Progress Tracker — department vocabulary change
--
--   weekend_programming + weekday_programming  ->  programming   (MERGE)
--   app                                        ->  website       (RENAME)
--   (new)                                      ->  operations    (ADD)
--
-- The vocabulary is duplicated in three places and all three must move
-- together or writes start failing:
--   1. project_tasks.department          CHECK constraint
--   2. team_members.departments          CHECK constraint (text[] containment)
--   3. DEPARTMENTS in lib/progress.js    (labels + validation)
--
-- ORDER MATTERS. The CHECK constraints are dropped first, then the data is
-- remapped, then the constraints are re-added with the new vocabulary. Remapping
-- while the old constraint is live would fail on 'programming'/'website', and
-- adding the new constraint before the remap would fail on the old rows.
--
-- The merge is many-to-one, so a team member tagged with BOTH programming
-- departments must collapse to a single 'programming' entry — the array
-- constraint tolerates duplicates but the UI would render the tag twice.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. Drop both constraints so the remap can run.
-- ---------------------------------------------------------------------------
alter table public.project_tasks
  drop constraint if exists project_tasks_department_check;

alter table public.team_members
  drop constraint if exists team_members_departments_check;

-- ---------------------------------------------------------------------------
-- 2. Remap task departments.
-- ---------------------------------------------------------------------------
update public.project_tasks
   set department = 'programming'
 where department in ('weekend_programming', 'weekday_programming');

update public.project_tasks
   set department = 'website'
 where department = 'app';

-- ---------------------------------------------------------------------------
-- 3. Remap team member department tags, de-duplicating the merge.
--    array_agg(distinct ...) also sorts, which is fine: these are a set, and
--    normalizeDepartmentTags() in lib/progress.js only preserves order of
--    whatever it is handed.
-- ---------------------------------------------------------------------------
update public.team_members m
   set departments = coalesce(remapped.departments, '{}'::text[])
  from (
    select tm.id,
           array_agg(distinct case d
                                when 'weekend_programming' then 'programming'
                                when 'weekday_programming' then 'programming'
                                when 'app'                 then 'website'
                                else d
                              end) as departments
      from public.team_members tm
      cross join unnest(tm.departments) as d
     group by tm.id
  ) as remapped
 where m.id = remapped.id
   and m.departments && array['weekend_programming', 'weekday_programming', 'app']::text[];

-- ---------------------------------------------------------------------------
-- 4. Re-add both constraints with the new vocabulary. Keep in sync with
--    DEPARTMENTS in lib/progress.js.
-- ---------------------------------------------------------------------------
alter table public.project_tasks
  add constraint project_tasks_department_check check (department in (
    'marketing', 'memberships', 'programming', 'operations', 'website',
    'data', 'supplies_inventory', 'products', 'awareness', 'management', 'legal'
  ));

alter table public.team_members
  add constraint team_members_departments_check check (
    departments <@ array[
      'marketing', 'memberships', 'programming', 'operations', 'website',
      'data', 'supplies_inventory', 'products', 'awareness', 'management', 'legal'
    ]::text[]
  );
