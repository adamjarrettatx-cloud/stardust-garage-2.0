-- =========================================================
-- Team-readable SOPs  (2026-08-03)
--
-- The document hub (20260611_documents_hub.sql) is admin-only end to end:
-- every policy on documents / document_versions / document_tags is
-- `using (public.is_admin())`. SOPs live in that same hub as
-- category = 'sops', so a team member who opened an SOP link could never
-- read the row — the middleware bounced them to /team/calendar first, and
-- RLS would have returned zero rows anyway.
--
-- SOPs are staff reading material, so this adds a READ-ONLY carve-out for
-- role = 'team'. Everything else about the hub is unchanged:
--
--   * Only category = 'sops' AND status = 'active' is exposed. Drafts and
--     archived revisions stay admin-only so an in-progress rewrite is not
--     mistaken for current policy.
--   * SELECT only. Insert / update / delete remain admin-only, so team
--     members cannot upload, edit, retitle or archive an SOP.
--   * Contracts, finance, vendor, marketing and 'other' documents are
--     untouched and remain invisible to non-admins.
--   * No storage.objects policy is added. Team members never get a direct
--     handle on the private bucket: /api/team/documents/:id/download
--     re-checks the category server-side and streams the bytes through the
--     service role, exactly like the admin download route.
--   * document_audit_log policies are unchanged (admin select, service-role
--     insert), so team views/downloads are still recorded but not readable
--     by the team member who made them.
--
-- public.is_team() (20260615_capacity_counter.sql) is true for role
-- 'admin' OR 'team'. Admins already pass the existing admin policies, and
-- PostgreSQL ORs permissive policies together, so this only widens access
-- for role = 'team'.
--
-- The allowed category list is mirrored in TEAM_VISIBLE_CATEGORIES in
-- lib/document-access.js — change both together.
-- =========================================================

drop policy if exists documents_team_select_sops on public.documents;
create policy documents_team_select_sops on public.documents
  for select to authenticated
  using (
    public.is_team()
    and category = 'sops'
    and status = 'active'
  );

drop policy if exists versions_team_select_sops on public.document_versions;
create policy versions_team_select_sops on public.document_versions
  for select to authenticated
  using (
    public.is_team()
    and exists (
      select 1
        from public.documents d
       where d.id = document_versions.document_id
         and d.category = 'sops'
         and d.status = 'active'
    )
  );

drop policy if exists tags_team_select_sops on public.document_tags;
create policy tags_team_select_sops on public.document_tags
  for select to authenticated
  using (
    public.is_team()
    and exists (
      select 1
        from public.documents d
       where d.id = document_tags.document_id
         and d.category = 'sops'
         and d.status = 'active'
    )
  );
