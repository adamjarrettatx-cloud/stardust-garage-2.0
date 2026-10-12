-- View Portal sandbox defense in depth. This migration belongs to the
-- isolated deployment branch and must not be merged into production.
-- pg_net is unused in this synthetic branch. Its functions and schema are
-- owned by Supabase's managed admin role, so revocation by the migration role
-- is not durable. Removing the unused extension removes database egress.
drop extension if exists pg_net;
