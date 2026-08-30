-- =========================================================
-- Event Organizer profiles + profile-first contract workflow
--
-- PURELY ADDITIVE. Every statement is guarded (IF NOT EXISTS / drop-if-exists
-- then recreate) so re-running is a no-op. Nothing here drops or rewrites an
-- existing column, and no existing row is mutated except by widening a CHECK.
--
-- WHY contacts is extended rather than a new event_organizers table:
--   * public.events.contact_id, public.documents.contact_id and
--     public.document_contracts.contact_id ALL already reference contacts(id).
--   * public.partner_profiles already gives a contact an authenticated login,
--     which is what the Event Organizer's in-app signing task needs.
--   * app/bananas/contacts/ContactsList.js derives its type tabs from
--     CONTACT_TYPE_OPTIONS, so a new type is list/filter-complete for free.
-- A parallel table would have forked all four. 'event_organizer' is therefore a
-- new contact_type, and contacts gains the legal-counterparty columns a signer
-- needs.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. contacts: 'event_organizer' relationship type + 'archived' state.
--
-- contact_type is a text[] with a <@ (contained-by) CHECK, so widening the
-- allowed set can never invalidate an existing row.
-- ---------------------------------------------------------------------------
alter table public.contacts drop constraint if exists contacts_contact_type_check;
alter table public.contacts add constraint contacts_contact_type_check
  check (contact_type <@ array[
    'dj','artist','performer','collective','promoter',
    'venue_renter','vendor','resident','event_organizer','other'
  ]::text[]);

-- 'archived' is the explicit archive state asked for by the Event Organizer
-- spec. The three pre-existing values are preserved verbatim, so no row moves.
alter table public.contacts drop constraint if exists contacts_status_check;
alter table public.contacts add constraint contacts_status_check
  check (status = any (array['active','inactive','do_not_book','archived']::text[]));

-- ---------------------------------------------------------------------------
-- 2. contacts: legal-counterparty fields.
--
-- All nullable with no default, so every existing contact stays valid and
-- unchanged. `legal_name` is the name that goes on the agreement;
-- `display_name` (already present, NOT NULL) stays the operational label.
-- default_signer_name/email are the send-time prefill for signer_1 and fall
-- back to primary_contact_name/email when unset.
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists legal_name           text,
  add column if not exists entity_type          text,
  add column if not exists address_line1        text,
  add column if not exists address_line2        text,
  add column if not exists address_city         text,
  add column if not exists address_state        text,
  add column if not exists address_postal_code  text,
  add column if not exists address_country      text,
  add column if not exists default_signer_name  text,
  add column if not exists default_signer_email text;

alter table public.contacts drop constraint if exists contacts_entity_type_check;
alter table public.contacts add constraint contacts_entity_type_check
  check (entity_type is null or entity_type = any (array['individual','business']::text[]));

comment on column public.contacts.legal_name is
  'Legal name of the counterparty as it should appear on an agreement. display_name stays the operational label.';
comment on column public.contacts.default_signer_name is
  'Prefilled signer_1 name when a contract is created for this contact. Falls back to primary_contact_name, then display_name.';
comment on column public.contacts.default_signer_email is
  'Prefilled signer_1 email when a contract is created for this contact. Falls back to email.';

create index if not exists contacts_status_idx on public.contacts(status);

-- ---------------------------------------------------------------------------
-- 3. contract_templates: Master vs Event agreement taxonomy.
--
-- 'master' = open-ended organizer relationship agreement.
-- 'event'  = event-specific agreement/addendum, optionally referencing the
--            organizer's Master Agreement.
-- requires_master marks event templates that must name a Master Agreement
-- before they can be sent. Default 'other' keeps every existing template valid.
-- ---------------------------------------------------------------------------
alter table public.contract_templates
  add column if not exists kind            text not null default 'other',
  add column if not exists requires_master boolean not null default false;

alter table public.contract_templates drop constraint if exists contract_templates_kind_check;
alter table public.contract_templates add constraint contract_templates_kind_check
  check (kind = any (array['master','event','other']::text[]));

create index if not exists contract_templates_kind_idx on public.contract_templates(kind);

comment on column public.contract_templates.kind is
  'master = open-ended organizer relationship agreement; event = event-specific agreement/addendum; other = anything else.';
comment on column public.contract_templates.requires_master is
  'When true, a contract created from this template must reference a Master Agreement before it can be sent.';

-- ---------------------------------------------------------------------------
-- 4. document_contracts: profile linkage, Master Agreement reference,
--    internal owner, and first-view tracking.
--
-- contact_id already exists and is the PRIMARY Event Organizer / counterparty
-- link — it is reused, not replaced. The three optional *_contact_id columns
-- are the V1 secondary profile associations (Artist, Collective, Vendor).
--
-- STATUS MODEL: deliberately unchanged. The repo already ships an 8-value
-- forward-only state machine (20260614_contract_lifecycle.sql +
-- lib/contract-helpers.js CONTRACT_TRANSITIONS) that lib/signnow.js
-- mapInviteStatusToContract() targets. "Viewed" is recorded as viewed_at plus a
-- contract_viewed audit row rather than a new state, so the merged state
-- machine and the SignNow mapping stay intact.
-- ---------------------------------------------------------------------------
alter table public.document_contracts
  add column if not exists master_contract_id    uuid references public.document_contracts(id) on delete set null,
  add column if not exists artist_contact_id     uuid references public.contacts(id) on delete set null,
  add column if not exists collective_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists vendor_contact_id     uuid references public.contacts(id) on delete set null,
  add column if not exists owner_user_id         uuid references auth.users(id) on delete set null,
  add column if not exists viewed_at             timestamptz,
  add column if not exists last_sent_at          timestamptz,
  add column if not exists send_count            integer not null default 0;

-- A contract cannot be its own Master Agreement.
alter table public.document_contracts drop constraint if exists document_contracts_master_not_self;
alter table public.document_contracts add constraint document_contracts_master_not_self
  check (master_contract_id is null or master_contract_id <> id);

create index if not exists document_contracts_contact_id_idx     on public.document_contracts(contact_id);
create index if not exists document_contracts_master_id_idx      on public.document_contracts(master_contract_id);
create index if not exists document_contracts_artist_id_idx      on public.document_contracts(artist_contact_id);
create index if not exists document_contracts_collective_id_idx  on public.document_contracts(collective_contact_id);
create index if not exists document_contracts_vendor_id_idx      on public.document_contracts(vendor_contact_id);
create index if not exists document_contracts_owner_idx          on public.document_contracts(owner_user_id);

comment on column public.document_contracts.contact_id is
  'PRIMARY counterparty profile — the Event Organizer for event-related contracts. Default legal counterparty and signer_1 source.';
comment on column public.document_contracts.master_contract_id is
  'For an Event Agreement: the Event Organizer''s applicable Master Agreement contract.';
comment on column public.document_contracts.viewed_at is
  'First time the counterparty was observed to open the document. Tracked as a timestamp, not a status, so the existing forward-only state machine is untouched.';

create index if not exists documents_contact_id_idx on public.documents(contact_id);

-- ---------------------------------------------------------------------------
-- 5. Widen the document audit-log action vocabulary.
--
-- The audit table still has insert+select policies only, so admins can never
-- rewrite history. This only adds permitted action values.
-- ---------------------------------------------------------------------------
-- The action check has been widened by other migrations between the time this
-- file was written and the time it ran (the ledger_* actions in particular).
-- The redefinition here preserves EVERY previously-allowed action verbatim and
-- only ADDS the five new contract actions; narrowing it would fail with a
-- CHECK violation against real audit rows. Keep this list a superset of every
-- production value if this migration is ever re-derived from schema.
alter table public.document_audit_log drop constraint if exists document_audit_log_action_check;
alter table public.document_audit_log add constraint document_audit_log_action_check
  check (action in (
    'upload','view','download','update_metadata','delete','restore','new_version',
    'contract_create','contract_status_change','contract_send','contract_signed','contract_void',
    -- pre-existing ledger actions from later migrations, kept verbatim
    'ledger_tickettailor_sync','ledger_spoton_upload','ledger_spoton_confirm',
    'ledger_quickbooks_connect','ledger_quickbooks_sync','ledger_quickbooks_disconnect',
    -- added by this migration
    'contract_resend','contract_viewed','contract_field_change','contract_notify','contract_archive'
  ));

-- ---------------------------------------------------------------------------
-- 6. contract_notifications — the counterparty's in-app signing task.
--
-- One row per "this contract awaits your signature" notice. The Event Organizer
-- reads it in /portal/contracts. Deliberately carries NO signing URL, NO
-- storage path and NO credential: it is a pointer to a contract the reader must
-- already be entitled to see. The actual signing act happens through SignNow's
-- own secure emailed invite.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_notifications (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.document_contracts(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Recipient is a contact (the Event Organizer), not an auth user: a contact
  -- may be notified before they have ever logged in.
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null default 'signature_requested'
    check (kind in ('signature_requested','signature_reminder','signature_completed','contract_canceled')),
  title text not null,
  body  text,
  email_sent_at timestamptz,
  read_at       timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists contract_notifications_contact_idx
  on public.contract_notifications(contact_id, created_at desc);
create index if not exists contract_notifications_contract_idx
  on public.contract_notifications(contract_id, created_at desc);
create index if not exists contract_notifications_unread_idx
  on public.contract_notifications(contact_id) where read_at is null;

alter table public.contract_notifications enable row level security;

-- Admins see and write everything.
drop policy if exists contract_notifications_admin_select on public.contract_notifications;
drop policy if exists contract_notifications_admin_insert on public.contract_notifications;
drop policy if exists contract_notifications_admin_update on public.contract_notifications;
drop policy if exists contract_notifications_admin_delete on public.contract_notifications;
create policy contract_notifications_admin_select on public.contract_notifications
  for select to authenticated using (public.is_admin());
create policy contract_notifications_admin_insert on public.contract_notifications
  for insert to authenticated with check (public.is_admin());
create policy contract_notifications_admin_update on public.contract_notifications
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contract_notifications_admin_delete on public.contract_notifications
  for delete to authenticated using (public.is_admin());

-- The counterparty reads ONLY their own notifications, resolved through the
-- existing definer function (which itself requires an ACTIVE partner profile,
-- so an invited-but-not-activated contact resolves to NULL and sees nothing).
drop policy if exists contract_notifications_partner_select on public.contract_notifications;
create policy contract_notifications_partner_select on public.contract_notifications
  for select to authenticated
  using (contact_id = public.partner_contact_id());

-- Marking your own notice read is the only write a counterparty gets. There is
-- no delete policy, so a counterparty can never erase a notice.
drop policy if exists contract_notifications_partner_update on public.contract_notifications;
create policy contract_notifications_partner_update on public.contract_notifications
  for update to authenticated
  using (contact_id = public.partner_contact_id())
  with check (contact_id = public.partner_contact_id());

-- ---------------------------------------------------------------------------
-- 7. partner_contracts() — the counterparty's contract list.
--
-- Mirrors the existing partner_grants() / partner_bookings() convention: a
-- SECURITY DEFINER RPC rather than a select policy on document_contracts, so
-- the admin-only RLS on documents / document_contracts / events stays exactly
-- as it is and the counterparty still gets a readable event title.
--
-- Returns only the fields a signer legitimately needs. Deliberately EXCLUDES
-- external_envelope_id, field_layout, field_values, notes and every storage
-- path — a counterparty must never receive an internal reference or a file
-- pointer from this function.
-- ---------------------------------------------------------------------------
drop function if exists public.partner_contracts();
create or replace function public.partner_contracts()
returns table (
  contract_id      uuid,
  document_id      uuid,
  title            text,
  status           text,
  event_id         uuid,
  event_title      text,
  event_date       date,
  effective_date   timestamptz,
  expiration_date  timestamptz,
  sent_at          timestamptz,
  completed_at     timestamptz,
  signer_name      text,
  signer_email     text,
  notified_at      timestamptz,
  notification_id  uuid,
  read_at          timestamptz
)
language sql stable security definer
set search_path = public, auth
as $$
  select
    c.id,
    c.document_id,
    d.title,
    c.status,
    c.event_id,
    e.title,
    e.event_date,
    c.effective_date,
    c.expiration_date,
    c.sent_at,
    c.completed_at,
    c.counterparty_name,
    c.counterparty_email,
    n.created_at,
    n.id,
    n.read_at
  from public.document_contracts c
  join public.documents d on d.id = c.document_id
  left join public.events e on e.id = c.event_id
  left join lateral (
    select n2.id, n2.created_at, n2.read_at
    from public.contract_notifications n2
    where n2.contract_id = c.id
      and n2.contact_id = c.contact_id
    order by n2.created_at desc
    limit 1
  ) n on true
  where c.contact_id is not null
    and c.contact_id = public.partner_contact_id()
    -- Only contracts that have actually left the building. A draft the staff is
    -- still assembling is invisible to the counterparty.
    and c.status <> 'draft'
  order by coalesce(c.sent_at, c.created_at) desc;
$$;

revoke all on function public.partner_contracts() from public;
grant execute on function public.partner_contracts() to authenticated;

comment on function public.partner_contracts() is
  'Contracts awaiting or completed by the signed-in partner/Event Organizer. Definer function so admin-only RLS on documents/document_contracts/events is unchanged. Returns no envelope ids, field data or storage paths.';
