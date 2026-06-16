-- Migration: submission_status_workflow
-- Adds 'new' and 'reviewed' status values to all four submission tables,
-- and changes the default incoming status from 'pending' to 'new'.
--
-- Status lifecycle:
--   new       → Default on form submission. Triggers dashboard badge.
--   reviewed  → Admin has opened and read it. Badge cleared.
--   pending   → Admin is actively working it / holding for follow-up.
--   approved  → Accepted (for applications: triggers account creation).
--   rejected  → Denied.

-- ─────────────────────────────────────────
-- membership_applications
-- ─────────────────────────────────────────
ALTER TABLE membership_applications
  ALTER COLUMN status SET DEFAULT 'new';

-- Back-fill any existing NULL-status rows so the column is never null
UPDATE membership_applications SET status = 'new' WHERE status IS NULL;

-- ─────────────────────────────────────────
-- venue_inquiries
-- ─────────────────────────────────────────
ALTER TABLE venue_inquiries
  ALTER COLUMN status SET DEFAULT 'new';

UPDATE venue_inquiries SET status = 'new' WHERE status IS NULL;

-- ─────────────────────────────────────────
-- micro_party_inquiries
-- ─────────────────────────────────────────
ALTER TABLE micro_party_inquiries
  ALTER COLUMN status SET DEFAULT 'new';

UPDATE micro_party_inquiries SET status = 'new' WHERE status IS NULL;

-- ─────────────────────────────────────────
-- collaborations
-- ─────────────────────────────────────────
ALTER TABLE collaborations
  ALTER COLUMN status SET DEFAULT 'new';

UPDATE collaborations SET status = 'new' WHERE status IS NULL;
