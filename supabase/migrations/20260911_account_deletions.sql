-- Immutable, service-role-only audit trail for completed self-service account
-- deletion. This intentionally retains only the former auth UUID, email,
-- optional user-supplied reason, origin, and completion time.
CREATE TABLE public.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id uuid NOT NULL,
  deleted_email text NOT NULL,
  reason text,
  initiated_from text,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions FROM anon, authenticated;
