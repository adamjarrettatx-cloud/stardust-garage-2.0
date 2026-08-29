-- =========================================================
-- Drop Potential Members
--
-- WHY: The admin-curated pre-application "Potential Members" list
-- (20260728_potential_members.sql) is retired. Owner decision 2026-08-29: the
-- workflow isn't used — people admins want as members are tracked in Contacts
-- and Applications instead, so a third parallel people list was dead weight.
--
-- This removes the feature completely: the /bananas/potential-members page,
-- the /api/admin/potential-members routes, lib/potential-members.js and the
-- admin dashboard tile are deleted in the same change.
--
-- SAFETY: verified before writing this migration that nothing else in the
-- schema depends on the table —
--   * 0 inbound foreign keys referencing potential_members
--   * 0 views referencing it
--   * 0 functions referencing it other than its own updated_at trigger fn
-- The only other mentions of "potential_members" in supabase/migrations
-- (20260729_guest_list_partners.sql, 20260819_trial_pass_intake.sql) are
-- comments pointing at the per-table trigger naming pattern, not real
-- dependencies.
--
-- DATA: the table held a single row at drop time, exported to JSON beforehand
-- and confirmed disposable by the owner. `drop table` therefore destroys no
-- record that isn't held elsewhere.
--
-- Dropping the table cascades away its own indexes, RLS policies and the
-- potential_members_set_updated_trg trigger; the trigger *function* is not
-- owned by the table, so it is dropped explicitly afterward.
-- =========================================================

drop table if exists public.potential_members cascade;

drop function if exists public.potential_members_set_updated();
