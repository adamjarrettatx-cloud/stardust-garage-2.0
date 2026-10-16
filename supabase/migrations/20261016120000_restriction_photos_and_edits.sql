-- Banned-list photos, editable identifying info, and similar-name matching.
-- Photos live in a PRIVATE bucket and are only ever served through short-lived
-- signed URLs minted by staff-authenticated server routes.
begin;

alter table public.access_restrictions
  add column if not exists photo_path text,
  add column if not exists photo_updated_at timestamptz,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists email text,
  add column if not exists phone text;

-- Pre-existing rows only stored normalized match keys; surface the original
-- contact keys so the edit form can show them.
update public.access_restrictions r set
  email = coalesce(r.email, (select substr(k, 7) from unnest(r.match_keys) k where k like 'email:%' limit 1)),
  phone = coalesce(r.phone, (select substr(k, 7) from unnest(r.match_keys) k where k like 'phone:%' limit 1));

alter table public.access_restriction_events drop constraint if exists access_restriction_events_action_check;
alter table public.access_restriction_events add constraint access_restriction_events_action_check
  check (action in ('created','note','lifted','same_person','different_person','updated'));

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('restriction-photos', 'restriction-photos', false, 10485760,
      array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- Create also persists the original aliases/email/phone. Patch the tested
-- function in place and abort on drift, matching prior restriction migrations.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.manage_access_restriction(uuid,text,jsonb)'::regprocedure);
  if position('insert into public.access_restrictions(full_name,kind,reason,identifying_details,match_keys,identity_keys,expires_at,created_by)' in def) = 0
    or position('coalesce(p_data->>''identifying_details'',''''),v_match,v_keys,(p_data->>''expires_at'')::timestamptz,p_actor)' in def) = 0 then
    raise exception 'Restriction function drift; review before migration';
  end if;
  def := replace(def,
    'insert into public.access_restrictions(full_name,kind,reason,identifying_details,match_keys,identity_keys,expires_at,created_by)',
    'insert into public.access_restrictions(full_name,kind,reason,identifying_details,match_keys,identity_keys,expires_at,created_by,aliases,email,phone)');
  def := replace(def,
    'coalesce(p_data->>''identifying_details'',''''),v_match,v_keys,(p_data->>''expires_at'')::timestamptz,p_actor)',
    'coalesce(p_data->>''identifying_details'',''''),v_match,v_keys,(p_data->>''expires_at'')::timestamptz,p_actor,
        coalesce(array(select jsonb_array_elements_text(coalesce(p_data->''aliases'',''[]''::jsonb))),''{}''),
        nullif(btrim(coalesce(p_data->>''email'','''')),''''),nullif(btrim(coalesce(p_data->>''phone'','''')),''''))');
  execute def;
end $$;

-- Edit identifying info and/or photo. Staff accounts only (no shared stations).
-- Match keys are append-only so an edit can never stop an earlier name,
-- email or phone from flagging; removing a ban still requires a manager lift.
create or replace function public.update_access_restriction(p_actor uuid, p_data jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_role text; v_label text; v_row public.access_restrictions; v_id uuid;
  v_match text[]; v_changes text[] := '{}'; v_name text; v_aliases text[];
  v_email text; v_phone text; v_details text; v_note text;
begin
  select role, coalesce(nullif(full_name,''), 'Staff') into v_role, v_label
    from public.team_members where user_id = p_actor;
  if v_role is null or v_role not in ('admin','team','front_desk') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_id := (p_data->>'id')::uuid;
  select * into v_row from public.access_restrictions where id = v_id for update;
  if not found then raise exception 'Restriction not found'; end if;
  if v_row.lifted_at is not null then raise exception 'Restriction is no longer active'; end if;

  if p_data ? 'full_name' then
    v_name := btrim(p_data->>'full_name');
    if length(v_name) not between 1 and 160 then raise exception 'A name of up to 160 characters is required.'; end if;
    if v_name is distinct from v_row.full_name then v_changes := array_append(v_changes, 'name'::text); end if;
  else v_name := v_row.full_name; end if;
  if p_data ? 'aliases' then
    v_aliases := coalesce(array(select btrim(a) from jsonb_array_elements_text(p_data->'aliases') a where btrim(a) <> ''), '{}');
    if v_aliases is distinct from v_row.aliases then v_changes := array_append(v_changes, 'aliases'::text); end if;
  else v_aliases := v_row.aliases; end if;
  if p_data ? 'email' then
    v_email := nullif(btrim(coalesce(p_data->>'email','')),'');
    if v_email is distinct from v_row.email then v_changes := array_append(v_changes, 'email'::text); end if;
  else v_email := v_row.email; end if;
  if p_data ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_data->>'phone','')),'');
    if v_phone is distinct from v_row.phone then v_changes := array_append(v_changes, 'phone'::text); end if;
  else v_phone := v_row.phone; end if;
  if p_data ? 'identifying_details' then
    v_details := btrim(coalesce(p_data->>'identifying_details',''));
    if length(v_details) > 2000 then raise exception 'Identifying details are too long.'; end if;
    if v_details is distinct from v_row.identifying_details then v_changes := array_append(v_changes, 'identifying details'::text); end if;
  else v_details := v_row.identifying_details; end if;
  if p_data ? 'photo_path' then
    if coalesce(p_data->>'photo_path','') !~ ('^' || v_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Invalid photo reference';
    end if;
    v_changes := array_append(v_changes, case when v_row.photo_path is null then 'photo added' else 'photo replaced' end::text);
  end if;

  select coalesce(array_agg(value),'{}') into v_match from jsonb_array_elements_text(coalesce(p_data->'match_keys','[]'::jsonb));
  if cardinality(v_changes) = 0 then raise exception 'No changes to save.'; end if;

  update public.access_restrictions set
    full_name = v_name, aliases = v_aliases, email = v_email, phone = v_phone,
    identifying_details = v_details,
    match_keys = array(select distinct unnest(match_keys || v_match)),
    photo_path = case when p_data ? 'photo_path' then p_data->>'photo_path' else photo_path end,
    photo_updated_at = case when p_data ? 'photo_path' then now() else photo_updated_at end
  where id = v_id;

  v_note := 'Updated ' || array_to_string(v_changes, ', ');
  if btrim(coalesce(p_data->>'comment','')) <> '' then v_note := v_note || ': ' || left(btrim(p_data->>'comment'), 1800); end if;
  insert into public.access_restriction_events(restriction_id,action,comment,actor_id,actor_label)
    values (v_id, 'updated', v_note, p_actor, v_label);
  return v_id;
end $$;
revoke all on function public.update_access_restriction(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.update_access_restriction(uuid,jsonb) to service_role;
commit;
