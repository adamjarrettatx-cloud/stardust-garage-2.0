-- Financial Write-Up: organizer sharing + POS proof screenshots.
--
-- * Organizers only ever see a frozen, organizer-safe snapshot that Adam
--   explicitly shares (organizer_snapshot). The snapshot is built server-side
--   and never contains Stardust Garage's take, the booking-fee amount on its
--   own, internal notes or rate settings.
-- * door_proofs lists POS screenshots stored in the private
--   event-writeup-proofs bucket. Paths never leave the server; organizers get
--   a short-lived signed link per proof only through the portal route.
-- * Visibility is limited to the event's organizer (events.contact_id) and
--   that organization's main contacts — not artists, guest-list holders or
--   other booked contacts who can otherwise see the event in the portal.

alter table public.event_writeups
  add column if not exists door_proofs jsonb not null default '[]'::jsonb,
  add column if not exists organizer_snapshot jsonb,
  add column if not exists shared_at timestamptz,
  add column if not exists shared_by uuid references auth.users(id) on delete set null;

do $$ begin
  alter table public.event_writeups
    add constraint event_writeups_door_proofs_array check (jsonb_typeof(door_proofs) = 'array');
exception when duplicate_object then null; end $$;

-- Private bucket: no storage.objects policies are added, so only the service
-- role (server routes) can read or write it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-writeup-proofs', 'event-writeup-proofs', false, 15728640,
        array['image/png','image/jpeg','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- True only for the event's organizer contact (or an organization whose main
-- contact is the signed-in partner). Deliberately narrower than
-- partner_has_event().
create or replace function public.partner_is_event_organizer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists(
    select 1 from public.events e
    where e.id = p_event_id
      and e.contact_id is not null
      and e.contact_id in (select id from public.partner_event_contact_ids() as id)
  );
$$;

revoke all on function public.partner_is_event_organizer(uuid) from public, anon;
grant execute on function public.partner_is_event_organizer(uuid) to authenticated;

-- Organizer-safe read. Returns {shared:false} until Adam shares; never
-- returns storage paths.
create or replace function public.partner_event_writeup(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare w public.event_writeups;
begin
  if not public.partner_is_event_organizer(p_event_id) then
    return jsonb_build_object('shared', false, 'organizer', false);
  end if;
  select * into w from public.event_writeups where event_id = p_event_id;
  if w.event_id is null or w.shared_at is null or w.organizer_snapshot is null then
    return jsonb_build_object('shared', false, 'organizer', true);
  end if;
  return jsonb_build_object(
    'shared', true,
    'organizer', true,
    'shared_at', w.shared_at,
    'writeup', w.organizer_snapshot,
    'proofs', coalesce((
      select jsonb_agg(jsonb_build_object('id', p->>'id', 'name', p->>'name', 'uploaded_at', p->>'uploaded_at'))
      from jsonb_array_elements(w.door_proofs) p
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.partner_event_writeup(uuid) from public, anon;
grant execute on function public.partner_event_writeup(uuid) to authenticated;
