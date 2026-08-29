# Progress Tracker — Runbook

Internal project-management / progress tracker that replaces the department
spreadsheet with an accountability workflow. Built on the existing Supabase
auth, roles, RLS conventions and design system. No external PM tool.

## What it is

- **Tasks** (`project_tasks`) — one row per deliverable (was one spreadsheet
  row): title, department/area, description, assignee, status, priority, due
  date, expected update cadence, next-update-due, percent complete, archived
  state, `created_by`, timestamps.
- **Updates** (`project_task_updates`) — chronological progress thread. Each
  update can carry the status/percent change it accompanied. Posting an update
  is the primary team action.
- **Activity** (`project_task_activity`) — immutable audit log written only by
  DB triggers (creation, status/assignment/priority/due/cadence/percent
  changes, completion, archive/unarchive, updates).

## Roles & permissions (MVP decision: Admin = General Manager)

There is **no separate Manager role in this PR**. The existing role
architecture is `owner` (email-gated) → `admin` → `team` → member/public. For
this MVP the existing **Admin** role carries the general-manager capability,
the **Owner** gets everything (plus the hard-delete escape hatch), and **Team**
members get scoped contribution rights. A dedicated `manager` role is a natural
follow-up (add it to `team_members.role`, extend `is_team()`/add `is_manager()`,
and split the admin policies) but was intentionally deferred to avoid changing
the role model in the same change that ships the feature.

| Action | Team | Admin (GM) | Owner |
| --- | --- | --- | --- |
| See tasks assigned to / created by them | ✅ | ✅ | ✅ |
| See all tasks / KPI dashboard / filters | ❌ | ✅ | ✅ |
| Post progress update / comment | ✅ (own tasks) | ✅ | ✅ |
| Change status (permitted states) | ✅ (own tasks) | ✅ | ✅ |
| Change percent complete | ✅ (own tasks) | ✅ | ✅ |
| Create / assign / reprioritise / due dates / cadence | ❌ | ✅ | ✅ |
| Archive / unarchive / mark complete | ❌ | ✅ | ✅ |
| CSV import | ❌ | ✅ | ✅ |
| Hard delete (destructive) | ❌ | ❌ | ✅ |

Enforcement is **server-side and in RLS**, never only in the UI:

- Reads: `project_tasks` SELECT policy returns everything to `is_admin()`, and
  only self-assigned/created rows to `is_team()`.
- Team writes: the **only** team mutation path is the
  `post_task_update(task_id, body, status, percent)` `SECURITY DEFINER` RPC,
  which re-checks membership and per-row authorization. Team members have **no**
  broad UPDATE grant, so they cannot reach admin-only records via direct API
  calls.
- Admin writes: RLS `is_admin()` INSERT/UPDATE policies. Routes additionally
  gate with `requireAdminMfa()`.
- Owner hard delete: no DELETE policy exists for anyone; the route gates with
  `requireOwner()` and uses the service-role client.
- Activity log: no client INSERT/UPDATE/DELETE policy — written solely by
  `SECURITY DEFINER` triggers, so it is immutable and unforgeable.
- All helpers (`is_admin()`, `is_team()`) read from the server-controlled
  `team_members` table, never editable `user_metadata` (Supabase advisor 0015).

## Navigation

- Admin/Owner: **Admin → Tasks** in the sidebar (`/team/progress`). Tasks is a
  top-level section of its own; the Team section it used to sit under no longer
  exists. `/bananas/progress` still redirects here.
- Team: **Events Calendar → TASKS** button (`/team/progress`).

Middleware already gates `/bananas/*` (admin) and `/team/*` (team+admin); no
middleware change was needed. The nav links are not the security boundary — the
page gates and RLS are.

## Applying the migration

The migration is **purely additive** (no existing table/column/policy is
altered) and idempotent (`create table if not exists`, `create or replace`,
`drop policy if exists`).

File: `supabase/migrations/20260723_progress_tracker.sql`

Apply it the same way as prior migrations (Supabase SQL editor / MCP / CLI). It
reuses the existing `public.is_admin()` and `public.is_team()` functions — apply
`20260611_documents_hub.sql` and `20260615_capacity_counter.sql` first if a
fresh environment does not yet have them.

```
# via Supabase CLI (example)
supabase db push
# or paste supabase/migrations/20260723_progress_tracker.sql into the SQL editor
```

No new environment variables are required. Existing
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` are sufficient. `ENFORCE_ADMIN_MFA` continues to
govern MFA step-up exactly as elsewhere.

## Importing the current spreadsheet

Owner/Admin → Progress → **IMPORT CSV**. Paste CSV with these headers
(aliases in parentheses are accepted):

```
Department/Area (Department, Area), Deliverable (Task, Title), Status (Notes, Progress)
```

- Departments are matched case-insensitively to the canonical list; unknown
  departments are reported per-line and skipped.
- The free-form **Status** text is **not** promoted to a real workflow status.
  It is mapped to the closest enum value (`mapImportStatus`) and the original
  note is preserved in the task's description, so nothing is lost and no
  critical/free-form note is silently trusted as production state.
- Import runs a **preview (dry run) first**; you confirm before any insert.

Departments: Marketing, Memberships, Weekend Programming, Weekday Programming,
App, Data, Supplies/Inventory, Products, Awareness, Management, Legal.

## Staleness / accountability model

A task is surfaced as needing attention when it is **overdue**, **blocked**, or
**stale**. Staleness uses the explicit `next_update_due` when a cadence is set
(advanced automatically each time an update is posted); otherwise it falls back
to "no update in `DEFAULT_STALE_DAYS` (7) days". The owner/admin dashboard shows
KPIs for overdue, blocked, stale, due-soon and recently-completed counts.

## Notifications

Out of scope for this MVP (no external Slack/email). The stale/overdue
indicators are surfaced in-app on the dashboard and the team's "Needs
attention" section.
