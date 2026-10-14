-- Submission conversations: an in-platform message thread between the SDG
-- team and the person who sent a Venue Inquiry, Micro Party, Collaboration or
-- Membership Application.
--
-- Flow:
--   1. An admin opens a submission and clicks "Invite to SDG". The server
--      creates one thread for that submission and a single-use-per-person
--      invite link (only its SHA-256 hash is stored here). The link goes to
--      the email on the submission, or a corrected address the admin enters.
--   2. The submitter opens /inbox/<token>, signs in or creates their free
--      Stardust account, and the server attaches the thread to that account
--      only when the account email matches the invited email.
--   3. Both sides write messages. The team can mark a message as a Question;
--      the submitter answers it inline (reply_to_id points at the question).
--
-- Everything is read and written by server routes using the service role.
-- Only admins can read these tables directly from a browser. Submitters read
-- their conversation solely through /api/account/conversations, which signs
-- every team message as "SDG Team" and never exposes which teammate wrote it
-- (author_id, author_name) or whether the team has read their messages
-- (team_last_read_at, awaiting_team). Invite tokens are never readable from
-- a browser. Team Notes (submission_notes) stay a separate, internal
-- table and are never shown to the submitter.

create table if not exists public.submission_threads (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type in (
    'applications', 'collaborations', 'micro-parties', 'venue-inquiries'
  )),
  submission_id uuid not null,
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  invite_email text not null check (invite_email = lower(btrim(invite_email)) and position('@' in invite_email) > 1),
  participant_user_id uuid references auth.users(id) on delete set null,
  participant_name text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  invited_at timestamptz not null default now(),
  claimed_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  last_team_message_at timestamptz,
  last_guest_message_at timestamptz,
  team_last_read_at timestamptz,
  guest_last_read_at timestamptz,
  -- Derived inbox flags so list pages and badges can filter without
  -- comparing two columns through PostgREST.
  awaiting_team boolean generated always as (
    last_guest_message_at is not null
    and (team_last_read_at is null or last_guest_message_at > team_last_read_at)
  ) stored,
  unread_by_guest boolean generated always as (
    last_team_message_at is not null
    and (guest_last_read_at is null or last_team_message_at > guest_last_read_at)
  ) stored,
  unique (submission_type, submission_id)
);

create index if not exists submission_threads_participant_idx
  on public.submission_threads(participant_user_id, greatest(last_team_message_at, last_guest_message_at) desc)
  where participant_user_id is not null;

create index if not exists submission_threads_awaiting_team_idx
  on public.submission_threads(awaiting_team)
  where awaiting_team and status = 'open';

create table if not exists public.submission_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.submission_threads(id) on delete cascade,
  author_kind text not null check (author_kind in ('team', 'guest')),
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  kind text not null default 'message' check (kind in ('message', 'question')),
  reply_to_id uuid references public.submission_thread_messages(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  -- Only the team asks Questions; only the submitter answers them.
  check (kind = 'message' or author_kind = 'team'),
  check (reply_to_id is null or author_kind = 'guest')
);

create index if not exists submission_thread_messages_thread_idx
  on public.submission_thread_messages(thread_id, created_at)
  where deleted_at is null;

-- Invite links. A thread can have several live links (a resend, or a team
-- message sent before the person joined) so an older email still works.
-- Changing the invite email revokes every earlier link.
create table if not exists public.submission_thread_invites (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.submission_threads(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days'),
  revoked_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

create index if not exists submission_thread_invites_thread_idx
  on public.submission_thread_invites(thread_id)
  where revoked_at is null;

alter table public.submission_threads enable row level security;
alter table public.submission_thread_messages enable row level security;
alter table public.submission_thread_invites enable row level security;

drop policy if exists submission_threads_select on public.submission_threads;
create policy submission_threads_select on public.submission_threads
  for select to authenticated
  using (public.is_admin());

drop policy if exists submission_thread_messages_select on public.submission_thread_messages;
create policy submission_thread_messages_select on public.submission_thread_messages
  for select to authenticated
  using (public.is_admin());

-- No browser policy at all on invites: tokens are server-only.

revoke all on public.submission_threads from anon;
revoke all on public.submission_thread_messages from anon;
revoke all on public.submission_thread_invites from anon, authenticated;
revoke insert, update, delete on public.submission_threads from authenticated;
revoke insert, update, delete on public.submission_thread_messages from authenticated;

comment on table public.submission_threads is
  'One SDG-to-submitter conversation per incoming submission. Server-only for submitters (they see SDG Team only); admins read directly.';
comment on table public.submission_thread_messages is
  'Messages and team Questions in a submission conversation. Soft-deleted rows stay as audit evidence.';
comment on table public.submission_thread_invites is
  'Hashed invite links that attach a submission conversation to a matching Stardust account. Service role only.';
