-- =========================================================
-- Progress Tracker — post-migration Supabase advisor fixes
--
-- Additive follow-up to 20260723_progress_tracker.sql. That migration has
-- already been applied to production, so it is NOT edited here; every
-- statement below is idempotent and safe to run on top of it.
--
-- Addresses the advisors raised after the tracker shipped:
--   1. SECURITY: trigger-only SECURITY DEFINER functions were EXECUTE-able by
--      anon/authenticated/public (inherited from the default PUBLIC grant),
--      which exposes them as callable RPCs. Triggers fire with the table
--      owner's rights and do NOT require EXECUTE on the function for the
--      invoking role, so revoking these grants keeps the triggers working
--      while removing the RPC surface.
--   2. PERFORMANCE: add covering indexes for the FK / audit columns
--      (actor_id, author_id, created_by).
--   3. PERFORMANCE (auth_rls_initplan): wrap auth.uid() in a scalar subquery
--      in the two new policies so it is evaluated once per statement instead
--      of once per row. The row predicates are otherwise unchanged — RLS is
--      not weakened.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. Lock down trigger-only SECURITY DEFINER functions.
--    These are invoked only by their AFTER/BEFORE triggers and must never be
--    reachable as PostgREST RPCs.
-- ---------------------------------------------------------------------------
revoke execute on function public.project_tasks_log_insert()    from public, anon, authenticated;
revoke execute on function public.project_tasks_log_update()    from public, anon, authenticated;
revoke execute on function public.project_task_updates_log()    from public, anon, authenticated;
-- Same category (trigger-only, no reason to be RPC-callable). Not SECURITY
-- DEFINER, so lower risk, but locked down for consistency.
revoke execute on function public.project_tasks_bookkeeping()   from public, anon, authenticated;

-- The constrained team write path stays callable only by authenticated users.
-- Re-assert explicitly (idempotent) so the intended grant is unambiguous.
revoke execute on function public.post_task_update(uuid, text, text, integer) from public, anon;
grant  execute on function public.post_task_update(uuid, text, text, integer) to authenticated;

-- can_read_task(uuid) is deliberately left EXECUTE-able by authenticated: the
-- project_task_updates / project_task_activity SELECT policies call it, so the
-- querying role must be able to run it.

-- ---------------------------------------------------------------------------
-- 2. Covering indexes for FK / audit columns flagged by the performance
--    advisor. Kept alongside the existing functional query indexes, which are
--    retained even though currently unused on empty tables.
-- ---------------------------------------------------------------------------
create index if not exists project_task_activity_actor_idx on public.project_task_activity(actor_id);
create index if not exists project_task_updates_author_idx on public.project_task_updates(author_id);
create index if not exists project_tasks_created_by_idx    on public.project_tasks(created_by);

-- ---------------------------------------------------------------------------
-- 3. Resolve auth_rls_initplan on the two new policies by wrapping auth.uid()
--    in a scalar subquery. Recreated verbatim except for that wrapping.
-- ---------------------------------------------------------------------------
drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks
  for select to authenticated using (
    public.is_admin()
    or (
      public.is_team() and (
        created_by = (select auth.uid())
        or assignee_id in (
          select tm.id from public.team_members tm where tm.user_id = (select auth.uid())
        )
      )
    )
  );

drop policy if exists project_task_updates_admin_insert on public.project_task_updates;
create policy project_task_updates_admin_insert on public.project_task_updates
  for insert to authenticated
  with check (public.is_admin() and author_id = (select auth.uid()));
