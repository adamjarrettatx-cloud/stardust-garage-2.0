begin;
create table if not exists public.membership_quiz_results (
  user_id uuid primary key references auth.users(id) on delete cascade,
  quiz_version integer not null default 1,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  gender_identity text check (gender_identity in ('male', 'female', 'other')),
  recommended_plans text[] not null check (cardinality(recommended_plans) between 1 and 2 and recommended_plans <@ array['weekender','cowork','cowork-party']::text[]),
  selected_plan text not null check (selected_plan in ('weekender','cowork','cowork-party')),
  completed_at timestamptz not null default now()
);
alter table public.membership_quiz_results enable row level security;
revoke all on public.membership_quiz_results from anon, authenticated;
grant select on public.membership_quiz_results to authenticated;
grant all on public.membership_quiz_results to service_role;
create policy "Read own membership quiz" on public.membership_quiz_results
  for select to authenticated using (auth.uid() = user_id);
-- Account-specific data: no public access, no client writes, no inferred pricing.
-- Completed quizzes are not paid memberships; analytics must join active
-- member_profiles by user_id when reporting member demographics.
-- Existing applications remain unchanged and may have no linked account/quiz.
alter table public.membership_applications
  add column if not exists applicant_user_id uuid references auth.users(id) on delete set null,
  add column if not exists quiz_answers jsonb,
  add column if not exists gender_identity text check (gender_identity in ('male', 'female', 'other')),
  add column if not exists submission_key uuid;
create unique index if not exists membership_application_submission_key
  on public.membership_applications(submission_key) where submission_key is not null;
create index if not exists membership_application_applicant
  on public.membership_applications(applicant_user_id) where applicant_user_id is not null;
comment on column public.membership_applications.quiz_answers is
  'Versioned, validated discovery responses attached only on application submission; not active membership counts.';
comment on column public.membership_applications.gender_identity is
  'Optional self-identification. NULL means not provided. Never authorizes a price or entitlement.';
-- Submission is now server-authoritative. Neither a browser nor an anon REST
-- request can bypass account, DOB, photo ownership, status or plan validation.
drop policy if exists "Anyone can submit a membership application" on public.membership_applications;
revoke insert on public.membership_applications from anon, authenticated;
-- Existing admin read/update policies and legacy application records are retained.
commit;
