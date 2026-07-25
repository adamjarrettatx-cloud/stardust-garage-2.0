ALTER TABLE signups
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

UPDATE signups
SET status = 'new'
WHERE status IS NULL;
