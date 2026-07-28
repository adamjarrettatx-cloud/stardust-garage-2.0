-- Audit trail for admin "Reply" emails sent from submission detail pages
-- (venue inquiries, micro-parties, collaborations, applications). These are
-- sent via Resend from hello@sdgatx.com with Reply-To set to the signed-in
-- admin's own work email (e.g. david@sdgatx.com), so replies from the
-- recipient land in that admin's real inbox. This table just records what
-- was sent, by whom, and to whom, for accountability across the team.

create table if not exists public.submission_email_replies (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type in (
    'applications', 'collaborations', 'micro-parties', 'venue-inquiries'
  )),
  submission_id uuid not null,
  sent_by uuid references auth.users(id) on delete set null,
  sent_by_email text not null,
  sent_by_name text,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists submission_email_replies_submission_idx
  on public.submission_email_replies(submission_type, submission_id, created_at desc);
create index if not exists submission_email_replies_sent_by_idx
  on public.submission_email_replies(sent_by, created_at desc);

alter table public.submission_email_replies enable row level security;

drop policy if exists submission_email_replies_admin_select on public.submission_email_replies;
drop policy if exists submission_email_replies_admin_insert on public.submission_email_replies;

create policy submission_email_replies_admin_select on public.submission_email_replies
  for select to authenticated using (public.is_admin());

create policy submission_email_replies_admin_insert on public.submission_email_replies
  for insert to authenticated with check (public.is_admin());
