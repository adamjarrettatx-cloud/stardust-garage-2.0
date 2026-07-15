-- =========================================================
-- Document full-text content search  (additive — safe to apply)
-- Builds on the Secure Document Hub (20260611_documents_hub.sql).
--
-- Goal: make keyword search on /admin/documents match the TEXT INSIDE uploaded
-- files (SOPs are Word/PDF), not just the title/description/tags/counterparty.
--
-- This migration is ADDITIVE and reuses the existing permission model:
--   * adds document_versions.extracted_text  (plain text pulled at upload time)
--   * adds documents.body_text               (denormalized, aggregated per-doc)
--   * folds body_text into documents.search_tsv (new weight 'D')
--   * backfills search_tsv for existing rows
--   * adds a SECURITY INVOKER search RPC so results can be ranked by ts_rank
--     while existing RLS (public.is_admin()) still gates every row.
-- It does NOT drop or repurpose any existing column, policy, or trigger.
--
-- The application (upload/version/signnow-archive routes) writes
-- document_versions.extracted_text; the trigger below keeps documents.body_text
-- and search_tsv in sync automatically.
-- =========================================================

-- 1. New columns -------------------------------------------------------------
alter table public.document_versions
  add column if not exists extracted_text text;

alter table public.documents
  add column if not exists body_text text;

-- 2. Fold body_text into search_tsv ------------------------------------------
-- Supersedes the 20260611 definition: identical title/counterparty/description
-- weighting, plus the file body text at the lowest weight ('D').
create or replace function public.documents_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.counterparty,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.description,'')), 'C') ||
    setweight(to_tsvector('simple', coalesce(new.body_text,'')), 'D');
  return new;
end; $$;

-- 3. Keep documents.body_text in sync with its versions' extracted_text ------
-- Aggregates every version's extracted text for the document. Writing body_text
-- fires documents_set_updated (above), which recomputes search_tsv. Running as
-- an AFTER trigger on document_versions means a normal upload (insert version)
-- transparently enriches the parent document's searchable content.
create or replace function public.documents_sync_body_text()
returns trigger language plpgsql set search_path = public as $$
declare
  v_doc uuid := coalesce(new.document_id, old.document_id);
  v_body text;
begin
  select nullif(string_agg(dv.extracted_text, E'\n' order by dv.version_number), '')
    into v_body
    from public.document_versions dv
   where dv.document_id = v_doc
     and dv.extracted_text is not null;

  update public.documents
     set body_text = v_body
   where id = v_doc
     and body_text is distinct from v_body;

  return null;
end; $$;

drop trigger if exists document_versions_sync_body_text_trg on public.document_versions;
create trigger document_versions_sync_body_text_trg
after insert or update of extracted_text or delete on public.document_versions
for each row execute function public.documents_sync_body_text();

-- 4. Backfill ----------------------------------------------------------------
-- Recompute body_text for any documents that already have versions, then a
-- no-op update rebuilds search_tsv via documents_set_updated for every row.
update public.documents d
   set body_text = sub.body
  from (
    select document_id,
           nullif(string_agg(extracted_text, E'\n' order by version_number), '') as body
      from public.document_versions
     where extracted_text is not null
     group by document_id
  ) sub
 where d.id = sub.document_id
   and d.body_text is distinct from sub.body;

update public.documents set updated_at = updated_at;

-- 5. Ranked search RPC -------------------------------------------------------
-- Returns matching documents ordered by full-text relevance, with a substring
-- (ilike) complement so partial/prefix words still match. SECURITY INVOKER (the
-- default for SQL functions) means the existing RLS policies on public.documents
-- apply to the caller: a non-admin gets zero rows, exactly as with a direct
-- select. PostgREST can embed related resources (versions/tags/events/contracts)
-- on this SETOF-table function, so the UI keeps its single round-trip.
create or replace function public.search_documents(
  p_q text default null,
  p_status text default 'active',
  p_category text default null
)
returns setof public.documents
language sql stable
set search_path = public
as $$
  select d.*
    from public.documents d
   where (p_status is null or p_status = '' or p_status = 'all' or d.status = p_status)
     and (p_category is null or p_category = '' or d.category = p_category)
     and (
       coalesce(p_q, '') = ''
       or d.search_tsv @@ websearch_to_tsquery('simple', p_q)
       or d.title ilike '%' || p_q || '%'
       or d.counterparty ilike '%' || p_q || '%'
       or d.description ilike '%' || p_q || '%'
     )
   order by
     ts_rank(d.search_tsv, websearch_to_tsquery('simple', coalesce(p_q, ''))) desc,
     d.updated_at desc;
$$;

revoke all on function public.search_documents(text, text, text) from public;
grant execute on function public.search_documents(text, text, text) to authenticated;
