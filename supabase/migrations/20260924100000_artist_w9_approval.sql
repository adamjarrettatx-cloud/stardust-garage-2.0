-- W-9 submission/approval. No TIN, name, address or signature in these rows.
-- Those fields exist only in the immutable, private PDF.
create table public.w9_reviewers (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
insert into public.w9_reviewers(user_id)
select t.user_id from public.team_members t join auth.users u on u.id=t.user_id
where t.role='admin' and lower(u.email) in
  ('adam@sdgatx.com','jeyu@sdgatx.com','naish@sdgatx.com');
alter table public.w9_reviewers enable row level security;
revoke all on public.w9_reviewers from anon,authenticated;
grant all on public.w9_reviewers to service_role;

create function public.w9_actor_is_reviewer(p_actor uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from w9_reviewers w join team_members t on t.user_id=w.user_id
    where w.user_id=p_actor and t.role='admin');
$$;
revoke all on function public.w9_actor_is_reviewer(uuid) from public,anon,authenticated;
grant execute on function public.w9_actor_is_reviewer(uuid) to service_role;
create function public.is_w9_reviewer() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.w9_actor_is_reviewer(auth.uid());
$$;
revoke all on function public.is_w9_reviewer() from public,anon;
grant execute on function public.is_w9_reviewer() to authenticated,service_role;

-- Off until the application deployment and production verification are complete.
create table public.w9_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.w9_settings values(true,false);
alter table public.w9_settings enable row level security;
revoke all on public.w9_settings from anon,authenticated;
grant all on public.w9_settings to service_role;
create function public.w9_enabled() returns boolean language sql stable security definer
set search_path=public,pg_temp as $$select coalesce((select enabled from w9_settings where singleton),false)$$;
revoke all on function public.w9_enabled() from public,anon;
grant execute on function public.w9_enabled() to authenticated,service_role;

create table public.w9_submissions (
  id uuid primary key,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  document_id uuid not null unique references public.documents(id) on delete restrict,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','approved','denied')),
  form_revision text not null default '2024-03',
  consent_version text not null default 'sdg-w9-v1',
  checksum_sha256 text not null check(checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  rejection_reason text,
  constraint w9_review_state check (
    (status='pending' and reviewed_at is null and reviewed_by is null and rejection_reason is null) or
    (status='approved' and reviewed_at is not null and reviewed_by is not null and rejection_reason is null) or
    (status='denied' and reviewed_at is not null and reviewed_by is not null and length(trim(rejection_reason)) between 1 and 1000)
  )
);
create unique index w9_one_open_or_approved on public.w9_submissions(contact_id)
  where status in ('pending','approved');
create index w9_contact_history on public.w9_submissions(contact_id,created_at desc,id);
alter table public.w9_submissions enable row level security;
revoke all on public.w9_submissions from anon,authenticated;
grant all on public.w9_submissions to service_role;

create table public.w9_audit_log (
  id bigint generated always as identity primary key,
  submission_id uuid references public.w9_submissions(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in ('form_opened','submitted','approved','denied','viewed','downloaded')),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  created_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);
alter table public.w9_audit_log enable row level security;
revoke all on public.w9_audit_log from anon,authenticated;
grant select,insert on public.w9_audit_log to service_role;
grant usage,select on sequence public.w9_audit_log_id_seq to service_role;

create function public.w9_submission_immutable() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'w9_immutable'; end if;
  if old.status<>'pending' or new.status not in ('approved','denied')
    or (to_jsonb(new)-array['status','reviewed_at','reviewed_by','rejection_reason'])
      is distinct from (to_jsonb(old)-array['status','reviewed_at','reviewed_by','rejection_reason'])
    or not public.w9_actor_is_reviewer(new.reviewed_by)
  then raise exception 'w9_immutable'; end if;
  return new;
end; $$;
create trigger w9_submission_immutable before update or delete on public.w9_submissions
for each row execute function public.w9_submission_immutable();

create function public.w9_has_approval(p_contact uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from w9_submissions where contact_id=p_contact and status='approved');
$$;
revoke all on function public.w9_has_approval(uuid) from public,anon;
grant execute on function public.w9_has_approval(uuid) to authenticated,service_role;

-- Manual tax-profile writes can no longer bypass review.
drop policy if exists "Admins can manage tax profiles" on public.contact_tax_profiles;
revoke insert,update,delete on public.contact_tax_profiles from authenticated,anon;
-- Staff need readiness, not the old notes or document identifiers.
revoke select on public.contact_tax_profiles from authenticated,anon;
grant select(contact_id,w9_on_file) on public.contact_tax_profiles to authenticated;
create function public.w9_tax_profile_guard() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if new.w9_on_file and not exists(select 1 from w9_submissions
    where contact_id=new.contact_id and document_id=new.w9_document_id and status='approved')
  then raise exception 'w9_approval_required'; end if;
  return new;
end; $$;
create trigger w9_tax_profile_guard before insert or update on public.contact_tax_profiles
for each row execute function public.w9_tax_profile_guard();

create function public.w9_booking_guard() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if public.w9_enabled() and (tg_op='INSERT' or new.contact_id is distinct from old.contact_id
    or new.event_id is distinct from old.event_id) then
    -- Serialize with submission/review and ensure even direct writes fail closed.
    perform 1 from contacts where id=new.contact_id for update;
    if not public.w9_has_approval(new.contact_id) then raise exception 'w9_approval_required'; end if;
  end if;
  return new;
end; $$;
create trigger w9_booking_guard before insert or update on public.event_bookings
for each row execute function public.w9_booking_guard();
-- The event's primary-contact field is another attachment path. Only
-- contractor contacts are gated; organizer/vendor-only contacts are unchanged.
create function public.w9_event_contact_guard() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if public.w9_enabled() and new.contact_id is not null
    and (tg_op='INSERT' or new.contact_id is distinct from old.contact_id)
    and exists(select 1 from contacts where id=new.contact_id
      and contact_type && array['dj','artist','performer']::text[])
    and not public.w9_has_approval(new.contact_id)
  then raise exception 'w9_approval_required'; end if;
  return new;
end; $$;
create trigger w9_event_contact_guard before insert or update on public.events
for each row execute function public.w9_event_contact_guard();
create function public.w9_pay_request_guard() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if public.w9_enabled() and not public.w9_has_approval(new.contact_id)
  then raise exception 'w9_approval_required'; end if;
  return new;
end; $$;
create trigger w9_pay_request_guard before insert on public.artist_pay_requests
for each row execute function public.w9_pay_request_guard();

-- Tax-file defense in depth: restrictive policies also intersect future
-- permissive policies. Downloads must go through the access-logged server.
create function public.w9_is_tax_document(p_document uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from documents where id=p_document and category='tax');
$$;
create function public.w9_is_tax_object(p_name text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select p_name like 'w9/%' or exists(select 1 from documents where category='tax' and id::text=split_part(p_name,'/',1))
    or exists(select 1 from document_versions v
    join documents d on d.id=v.document_id where v.storage_path=p_name and d.category='tax');
$$;
revoke all on function public.w9_is_tax_document(uuid),public.w9_is_tax_object(text) from public,anon;
grant execute on function public.w9_is_tax_document(uuid),public.w9_is_tax_object(text) to authenticated,service_role;
create policy w9_documents_read on public.documents as restrictive for select to authenticated
using(category<>'tax' or public.is_w9_reviewer());
create policy w9_documents_insert on public.documents as restrictive for insert to authenticated
with check(category<>'tax');
create policy w9_documents_update on public.documents as restrictive for update to authenticated
using(category<>'tax') with check(category<>'tax');
create policy w9_documents_delete on public.documents as restrictive for delete to authenticated using(category<>'tax');
create policy w9_versions_read on public.document_versions as restrictive for select to authenticated
using(not public.w9_is_tax_document(document_id) or public.is_w9_reviewer());
create policy w9_versions_insert on public.document_versions as restrictive for insert to authenticated
with check(not public.w9_is_tax_document(document_id));
create policy w9_versions_update on public.document_versions as restrictive for update to authenticated
using(not public.w9_is_tax_document(document_id)) with check(not public.w9_is_tax_document(document_id));
create policy w9_versions_delete on public.document_versions as restrictive for delete to authenticated
using(not public.w9_is_tax_document(document_id));
create policy w9_storage_boundary on storage.objects as restrictive for all to authenticated
using(bucket_id<>'documents' or not public.w9_is_tax_object(name))
with check(bucket_id<>'documents' or not public.w9_is_tax_object(name));

create function public.w9_protect_document() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if tg_table_name='documents' then v_id:=old.id;
  elsif tg_op='INSERT' then v_id:=new.document_id;
  else v_id:=old.document_id; end if;
  if exists(select 1 from w9_submissions where document_id=v_id) then
    raise exception 'w9_document_immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger w9_protect_document before update or delete on public.documents
for each row execute function public.w9_protect_document();
create trigger w9_protect_version before insert or update or delete on public.document_versions
for each row execute function public.w9_protect_document();

-- Atomically records a PDF already uploaded by the server. A duplicate attempt
-- with the same submission ID returns the existing result without new alerts.
create function public.submit_artist_w9(
 p_id uuid,p_document uuid,p_contact uuid,p_actor uuid,p_path text,p_hash text,p_size integer,
 p_ip text default null,p_agent text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing w9_submissions; v_version uuid:=gen_random_uuid();
begin
 if not public.w9_enabled() then raise exception 'w9_disabled'; end if;
 perform 1 from contacts where id=p_contact for update;
 if not exists(select 1 from partner_profiles p join contacts c on c.id=p.contact_id
   where p.user_id=p_actor and p.contact_id=p_contact and p.is_active and p.activated_at is not null
   and nullif(trim(p.full_name),'') is not null and nullif(p.photo_url,'') is not null
   and c.contact_type && array['dj','artist','performer']::text[]
   and not exists(select 1 from team_members t where t.user_id=p_actor and t.role in ('front_desk','calendar_viewer')))
 then raise exception 'w9_artist_required'; end if;
 select * into v_existing from w9_submissions where id=p_id;
 if found then
   if v_existing.contact_id<>p_contact or v_existing.submitted_by<>p_actor then raise exception 'w9_conflict'; end if;
   return v_existing.id;
 end if;
 if exists(select 1 from w9_submissions where contact_id=p_contact and status in ('pending','approved'))
 then raise exception 'w9_already_submitted'; end if;
 if p_path<>('w9/'||p_contact||'/'||p_id||'.pdf') or p_size not between 1000 and 2000000
 then raise exception 'w9_invalid_document'; end if;
 insert into documents(id,title,category,status,created_by,contact_id)
 values(p_document,'Artist W-9','tax','active',p_actor,p_contact);
 insert into document_versions(id,document_id,version_number,storage_path,filename,mime_type,size_bytes,checksum_sha256,uploaded_by)
 values(v_version,p_document,1,p_path,'W9.pdf','application/pdf',p_size,p_hash,p_actor);
 insert into w9_submissions(id,contact_id,document_id,submitted_by,checksum_sha256)
 values(p_id,p_contact,p_document,p_actor,p_hash);
 insert into w9_audit_log(submission_id,actor_id,action,contact_id,ip_address,user_agent)
 values(p_id,p_actor,'submitted',p_contact,p_ip,left(p_agent,500));
 insert into notifications(user_id,type,title,body,data,channels_sent)
 select w.user_id,'w9_review_requested','review and approve','An artist W-9 is ready for review.',
 jsonb_build_object('url','/bananas/contacts/'||p_contact||'?tab=tax','submission_id',p_id),array['in_app']
 from w9_reviewers w where public.w9_actor_is_reviewer(w.user_id);
 return p_id;
end; $$;
revoke all on function public.submit_artist_w9(uuid,uuid,uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.submit_artist_w9(uuid,uuid,uuid,uuid,text,text,integer,text,text) to service_role;

create function public.review_artist_w9(p_id uuid,p_actor uuid,p_decision text,p_reason text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare s w9_submissions; v_contact uuid;
begin
 if not public.w9_enabled() then raise exception 'w9_disabled'; end if;
 if not public.w9_actor_is_reviewer(p_actor) then raise exception 'w9_reviewer_required'; end if;
 if p_decision not in ('approved','denied') then raise exception 'w9_invalid_decision'; end if;
 if p_decision='denied' and (p_reason is null or length(trim(p_reason)) not between 1 and 1000)
 then raise exception 'w9_reason_required'; end if;
 select contact_id into v_contact from w9_submissions where id=p_id;
 perform 1 from contacts where id=v_contact for update;
 select * into s from w9_submissions where id=p_id for update;
 if not found then raise exception 'w9_not_found'; end if;
 if s.status<>'pending' then raise exception 'w9_already_reviewed'; end if;
 update w9_submissions set status=p_decision,reviewed_by=p_actor,reviewed_at=now(),
   rejection_reason=case when p_decision='denied' then trim(p_reason) else null end where id=p_id;
 if p_decision='approved' then
   insert into contact_tax_profiles(contact_id,w9_on_file,w9_document_id,w9_received_at,created_by,updated_by)
   values(s.contact_id,true,s.document_id,s.created_at,p_actor,p_actor)
   on conflict(contact_id) do update set w9_on_file=true,w9_document_id=excluded.w9_document_id,
     w9_received_at=excluded.w9_received_at,updated_by=p_actor;
 end if;
 insert into w9_audit_log(submission_id,actor_id,action,contact_id)
 values(p_id,p_actor,p_decision,s.contact_id);
 insert into notifications(user_id,type,title,body,data,channels_sent)
 select p.user_id,'w9_reviewed',case when p_decision='approved' then 'W-9 approved' else 'W-9 needs changes' end,
 case when p_decision='approved' then 'You can now be booked for events.' else 'Open your profile to read the reviewer comment and submit a new W-9.' end,
 jsonb_build_object('url','/account/profile#w9','submission_id',p_id),array['in_app']
 from partner_profiles p where p.contact_id=s.contact_id;
 return p_decision;
end; $$;
revoke all on function public.review_artist_w9(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_artist_w9(uuid,uuid,text,text) to service_role;
