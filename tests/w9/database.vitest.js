import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
let db;
const artist='11111111-1111-4111-8111-111111111111';
const adam='22222222-2222-4222-8222-222222222222';
const jeyu='33333333-3333-4333-8333-333333333333';
const naish='44444444-4444-4444-8444-444444444444';
const outsider='55555555-5555-4555-8555-555555555555';
const contact='66666666-6666-4666-8666-666666666666';
const first='77777777-7777-4777-8777-777777777777';
const second='88888888-8888-4888-8888-888888888888';
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table team_members(user_id uuid primary key,role text);
    create table contacts(id uuid primary key,contact_type text[] not null);
    create table partner_profiles(user_id uuid primary key,contact_id uuid unique,full_name text,photo_url text,is_active boolean,activated_at timestamptz);
    create table documents(id uuid primary key,title text,category text,status text,created_by uuid,contact_id uuid,current_version_id uuid);
    create table document_versions(id uuid primary key,document_id uuid references documents(id),version_number int,storage_path text unique,filename text,mime_type text,size_bytes bigint,checksum_sha256 text,uploaded_by uuid);
    create function set_current_version() returns trigger language plpgsql as $$begin update documents set current_version_id=new.id where id=new.document_id;return new;end$$;
    create trigger versions_current after insert on document_versions for each row execute function set_current_version();
    create table contact_tax_profiles(contact_id uuid primary key,w9_on_file boolean,w9_document_id uuid,w9_received_at timestamptz,created_by uuid,updated_by uuid,notes text);
    create table notifications(user_id uuid,type text,title text,body text,data jsonb,channels_sent text[]);
    create table event_bookings(id uuid default gen_random_uuid(),contact_id uuid,event_id uuid);
    create table events(id uuid default gen_random_uuid(),contact_id uuid);
    create table artist_pay_requests(id uuid default gen_random_uuid(),contact_id uuid);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table documents enable row level security;
    alter table document_versions enable row level security;
    alter table storage.objects enable row level security;
    create policy admin_docs on documents for all to authenticated using(true) with check(true);
    create policy admin_versions on document_versions for all to authenticated using(true) with check(true);
    create policy admin_storage on storage.objects for all to authenticated using(true) with check(true);
    grant usage on schema public,auth,storage to authenticated;
    grant all on all tables in schema public,storage to authenticated;
    insert into auth.users values('${artist}','artist@example.test'),('${adam}','adam@sdgatx.com'),('${jeyu}','jeyu@sdgatx.com'),('${naish}','naish@sdgatx.com'),('${outsider}','another-admin@example.test');
    insert into team_members values('${adam}','admin'),('${jeyu}','admin'),('${naish}','admin'),('${outsider}','admin');
    insert into contacts values('${contact}',array['artist']);
    insert into partner_profiles values('${artist}','${contact}','Test Artist','/test-photo',true,now());
  `);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260924100000_artist_w9_approval.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
  await db.exec(`reset role; truncate w9_audit_log,w9_submissions,document_versions,documents,notifications,contact_tax_profiles,event_bookings,events,artist_pay_requests,storage.objects cascade;
    update w9_settings set enabled=true;
    update team_members set role='admin';
    update partner_profiles set is_active=true,full_name='Test Artist',photo_url='/test-photo',activated_at=now();
    delete from team_members where user_id='${artist}';`);
});
afterAll(async()=>{await db?.close()});
async function submit(id=first,who=artist){
  return db.query('select submit_artist_w9($1,$1,$2,$3,$4,$5,10000)',
    [id,contact,who,`w9/${contact}/${id}.pdf`,'a'.repeat(64)]);
}
const review=(decision='approved',who=adam,reason=null,id=first)=>db.query('select review_artist_w9($1,$2,$3,$4)',[id,who,decision,reason]);
const book=()=>db.query('insert into event_bookings(contact_id) values($1)',[contact]);
async function asUser(id,query) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
  try { return await db.exec(query); } finally { await db.exec('reset role'); }
}
describe('W-9 PostgreSQL approval and privacy boundaries',()=>{
  it('seeds only the three approved reviewers',async()=>{
    expect((await db.query('select user_id from w9_reviewers order by user_id')).rows.map(r=>r.user_id)).toEqual([adam,jeyu,naish]);
  });
  it('blocks disabled onboarding',async()=>{
    await db.exec('update w9_settings set enabled=false');
    await expect(submit()).rejects.toThrow('w9_disabled');
  });
  it('blocks booking and pay requests with no submission or a pending form',async()=>{
    await expect(book()).rejects.toThrow('w9_approval_required');
    await submit();
    await expect(book()).rejects.toThrow('w9_approval_required');
    await expect(db.query('insert into artist_pay_requests(contact_id) values($1)',[contact])).rejects.toThrow('w9_approval_required');
    await expect(db.query('insert into events(contact_id) values($1)',[contact])).rejects.toThrow('w9_approval_required');
  });
  it('submits once and notifies exactly Adam, Jeyu and Naish',async()=>{
    await submit();await submit();
    expect((await db.query('select count(*)::int as n from w9_submissions')).rows[0].n).toBe(1);
    expect((await db.query('select user_id from notifications order by user_id')).rows.map(r=>r.user_id)).toEqual([adam,jeyu,naish]);
    expect((await db.query('select count(*)::int as n from w9_audit_log')).rows[0].n).toBe(1);
    expect((await db.query('select current_version_id from documents')).rows[0].current_version_id).toBeTruthy();
    await expect(submit(second)).rejects.toThrow('w9_already_submitted');
  });
  it.each([adam,jeyu,naish])('permits one approved reviewer %s to unlock booking and pay',async(who)=>{
    await submit();await review('approved',who);await book();
    await db.query('insert into events(contact_id) values($1)',[contact]);
    await db.query('insert into artist_pay_requests(contact_id) values($1)',[contact]);
    expect((await db.query('select w9_on_file from contact_tax_profiles')).rows[0].w9_on_file).toBe(true);
    expect((await db.query("select user_id from notifications where type='w9_reviewed'")).rows[0].user_id).toBe(artist);
  });
  it('requires a denial comment and a brand new immutable signed submission',async()=>{
    await submit();await expect(review('denied')).rejects.toThrow('w9_reason_required');
    await review('denied',adam,'Correct line 1.');
    await expect(book()).rejects.toThrow('w9_approval_required');
    await submit(second);await review('approved',jeyu,null,second);
    expect((await db.query('select status from w9_submissions order by id')).rows.map(r=>r.status)).toEqual(['denied','approved']);
    await expect(review()).rejects.toThrow('w9_already_reviewed');
  });
  it('refuses another admin and a removed reviewer',async()=>{
    await submit();await expect(review('approved',outsider)).rejects.toThrow('w9_reviewer_required');
    await db.query("update team_members set role='team' where user_id=$1",[adam]);
    await expect(review()).rejects.toThrow('w9_reviewer_required');
  });
  it('rejects incomplete, inactive, wrong-identity and restricted artist submissions',async()=>{
    await expect(submit(first,outsider)).rejects.toThrow('w9_artist_required');
    await db.exec('update partner_profiles set photo_url=null');
    await expect(submit()).rejects.toThrow('w9_artist_required');
    await db.exec("update partner_profiles set photo_url='/test-photo',is_active=false");
    await expect(submit()).rejects.toThrow('w9_artist_required');
    await db.exec(`update partner_profiles set is_active=true;insert into team_members values('${artist}','front_desk')`);
    await expect(submit()).rejects.toThrow('w9_artist_required');
  });
  it('blocks old manual on-file bypass and record/file mutation',async()=>{
    await expect(db.query('insert into contact_tax_profiles(contact_id,w9_on_file) values($1,true)',[contact])).rejects.toThrow('w9_approval_required');
    await submit();
    for(const sql of ["delete from w9_submissions","update w9_submissions set checksum_sha256=repeat('b',64)","update documents set category='other'","delete from documents","update document_versions set storage_path='replacement.pdf'","delete from document_versions"]) {
      await expect(db.exec(sql)).rejects.toThrow(/w9_(immutable|document_immutable)/);
    }
  });
  it('blocks document replacement via insert and booking reassignment',async()=>{
    await submit();await review();await book();
    await expect(db.exec(`insert into document_versions(id,document_id) values(gen_random_uuid(),'${first}')`)).rejects.toThrow('w9_document_immutable');
    await db.exec(`insert into contacts values('${second}',array['artist'])`);
    await expect(db.exec(`update event_bookings set contact_id='${second}'`)).rejects.toThrow('w9_approval_required');
    await db.exec(`delete from contacts where id='${second}'`);
  });
  it('denies direct authenticated RPCs and sensitive table reads even to reviewers',async()=>{
    await expect(asUser(adam,'select * from w9_submissions')).rejects.toThrow('permission denied');
    await expect(asUser(adam,`select review_artist_w9('${first}','${adam}','approved')`)).rejects.toThrow('permission denied');
    await expect(asUser(adam,'select notes from contact_tax_profiles')).rejects.toThrow('permission denied');
  });
  it('restricts tax metadata and blocks direct tax storage access even for reviewers',async()=>{
    await submit();
    await db.exec(`insert into storage.objects(bucket_id,name) values('documents','w9/${contact}/${first}.pdf'),('documents','${first}/legacy.pdf'),('documents','ordinary.pdf')`);
    const hidden=await asUser(outsider,'select * from documents');
    expect(hidden[0].rows).toHaveLength(0);
    const visible=await asUser(adam,'select * from documents');
    expect(visible[0].rows).toHaveLength(1);
    const files=await asUser(adam,'select name from storage.objects');
    expect(files[0].rows).toEqual([{name:'ordinary.pdf'}]);
    await expect(asUser(outsider,`insert into storage.objects(bucket_id,name) values('documents','w9/forged.pdf')`)).rejects.toThrow('row-level security');
  });
});
