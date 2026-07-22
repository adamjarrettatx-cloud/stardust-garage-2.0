-- Reusable contract templates with a saved, visually-placed field layout.
-- NOTE: this migration was applied to the live Supabase project
-- (iwgfelvbebqbaotkylsw) ahead of the code landing; this file commits it to the
-- repo so the schema history stays in sync. Re-running is guarded with IF NOT
-- EXISTS so it is a no-op against the already-migrated database.
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'contracts'
    CHECK (category = ANY (ARRAY['contracts','finance','sops','vendor','marketing','team','other'])),
  storage_path text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  size_bytes bigint,
  checksum_sha256 text,
  page_count integer,
  -- Array of field defs: [{id,type,label,page_number,x,y,width,height,required,assigned_to}]
  -- assigned_to is 'business' (staff fills before send) or 'signer_1'/'signer_2'/... (recipient fills at signing).
  field_layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

-- Per-contract field layout (cloned from template at creation, then independently
-- customizable per Adam's requirement that recipient-fillable fields vary per document)
-- and the staff-entered values for the 'business' role fields on this specific contract.
ALTER TABLE public.document_contracts
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.contract_templates(id),
  ADD COLUMN IF NOT EXISTS field_layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS field_values jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.document_contracts.field_layout IS 'Per-contract copy of the field layout (same shape as contract_templates.field_layout), independently editable per send.';
COMMENT ON COLUMN public.document_contracts.field_values IS 'Staff-entered values for assigned_to=business fields, keyed by field id: {"<field_id>": "<value>"}.';
