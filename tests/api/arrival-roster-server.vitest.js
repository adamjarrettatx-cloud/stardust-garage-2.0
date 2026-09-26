import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/profile-photo', () => ({
  createProfilePhotoSignedUrl: async (_admin, path) => path ? { signedUrl:'https://example.invalid/signed-photo' } : null,
}));
vi.mock('@/lib/member-photo', () => ({
  resolveMemberPhotoUrl: async (_admin, row) => row.profile_photo_path || row.photo_url ? 'https://example.invalid/member-photo' : null,
}));
import { loadRoster } from '@/lib/capacity/arrival-roster-server';
const now = new Date('2026-09-25T02:00:00Z');
const pass = overrides => ({id:'p1',full_name:'Jordan Rivera',user_id:'u1',guest_profile_id:'g1',member_profile_id:null,
  issued_at:'2026-09-25T01:00:00Z',status:'active',signup_expires_at:'2026-11-01T00:00:00Z',
  activated_at:null,profile_photo_path:'private/path',...overrides});
function database(overrides={}, fail=null) {
  const tables={trial_passes:[pass()],guest_profiles:[{id:'g1',full_name:'Jordan Rivera'}],
    member_profiles:[],free_accounts:[],front_desk_arrivals:[],door_sessions:[],events:[],...overrides};
  const calls=[];
  return {calls,from(table) {
    let filters=[],orders=[],limit=Infinity;
    const b={
      select: columns => {calls.push({table,columns});return b},
      eq: (key,value) => {filters.push(r=>r[key]===value);return b},
      is: (key,value) => {filters.push(r=>(r[key]??null)===value);return b},
      in: (key,values) => {filters.push(r=>values.includes(r[key]));return b},
      gte: (key,value) => {filters.push(r=>r[key]>=value);return b},
      ilike: (key,value) => {const needle=value.slice(1,-1).replace(/\\([\\%_])/g,'$1').toLowerCase();filters.push(r=>String(r[key]||'').toLowerCase().includes(needle));return b},
      order: (key,options={}) => {orders.push({key,ascending:options.ascending!==false});return b},
      limit: n => {limit=n;return b},
      then(resolve,reject) {
        let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));
        rows=[...rows].sort((a,b)=>{for(const {key,ascending} of orders){const n=String(a[key]).localeCompare(String(b[key]));if(n)return ascending?n:-n}return 0}).slice(0,limit);
        return Promise.resolve(table===fail?{error:{message:'Offline'}}:{data:rows}).then(resolve,reject);
      },
    };return b;
  }};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now)});
afterEach(()=>vi.useRealTimers());
describe('directory and arrival projection',()=>{
  it('searches historical people, not just this shift, and excludes them from tonight until arrival',async()=>{
    const db=database({trial_passes:[pass({issued_at:'2026-09-01T01:00:00Z'})]});
    expect((await loadRoster(db,{now})).signins).toEqual([]);
    const search=await loadRoster(db,{query:'Jordan',now});
    expect(search.signins).toHaveLength(1);
    expect(search.signins[0].full_name).toBe('Jordan Rivera');
    expect(search.signins[0].activity_at).toBeNull();
    expect(search.signins[0].photo_url).toContain('signed-photo');
  });
  it('deduplicates explicit trial, member and guest links without merging equal names',async()=>{
    const db=database({
      trial_passes:[pass({member_profile_id:'m1'}),pass({id:'p2',user_id:'u2',guest_profile_id:'g2'})],
      member_profiles:[{id:'m1',user_id:'u1',full_name:'Jordan Rivera',is_active:true,subscription_status:'active',photo_url:'old-photo'}],
      guest_profiles:[{id:'g1',full_name:'Jordan Rivera'},{id:'g2',full_name:'Jordan Rivera'}],
    });
    const data=await loadRoster(db,{query:'Jordan',now});
    expect(data.signins).toHaveLength(2);
    expect(data.signins.map(r=>r.kind)).toContain('member');
    expect(data.people.find(p=>p.wire.kind==='member').identityKeys).toEqual(expect.arrayContaining(['trial_pass:p1','member:m1','guest:g1','user:u1']));
  });
  it('merges the signup and a later check-in into one row by latest timestamp',async()=>{
    const db=database({front_desk_arrivals:[{id:'a1',subject_kind:'trial_pass',subject_id:'p1',identity_keys:['trial_pass:p1','user:u1'],
      shift_day:'2026-09-24',checked_in_at:'2026-09-25T01:05:00Z'}]});
    const data=await loadRoster(db,{now});
    expect(data.signins).toHaveLength(1);
    expect(data.signins[0].activity_at).toBe('2026-09-25T01:05:00Z');
    expect(data.signins[0].activity_kind).toBe('check_in');
    expect(data.signins[0].checked_in_at).toBeTruthy();
  });
  it('returns a returning guest admission in tonight even when signup is old',async()=>{
    const db=database({trial_passes:[pass({issued_at:'2026-09-01T01:00:00Z'})],
      front_desk_arrivals:[{id:'a1',subject_kind:'trial_pass',subject_id:'p1',identity_keys:['trial_pass:p1'],
        shift_day:'2026-09-24',checked_in_at:'2026-09-25T01:05:00Z'}]});
    expect((await loadRoster(db,{now})).signins[0].activity_kind).toBe('check_in');
  });
  it('keeps expired visitors searchable but not eligible for roster admission',async()=>{
    const data=await loadRoster(database({trial_passes:[pass({status:'expired'})]}),{query:'Jordan',now});
    expect(data.signins).toHaveLength(1);
    expect(data.signins[0].admission_reason).toBeTruthy();
  });
  it('lets a photo-less Trial Pass be checked in from the roster',async()=>{
    const data=await loadRoster(database({trial_passes:[pass({profile_photo_path:null})]}),{query:'Jordan',now});
    expect(data.signins).toHaveLength(1);
    expect(data.signins[0].admission_reason).toBeNull();
  });
  it('fails closed for event lookup or identity database errors',async()=>{
    await expect(loadRoster(database({},'guest_profiles'),{query:'Jordan',now})).rejects.toThrow('lookup unavailable');
    await expect(loadRoster(database({door_sessions:[{id:'d',event_id:'missing',closed_at:null}]}),{now})).rejects.toThrow('Active event');
  });
  it('search response never includes private identifiers, storage paths, contacts or bearer credentials',async()=>{
    const data=await loadRoster(database(),{query:'Jordan',now});
    const wire=JSON.stringify(data.signins);
    for(const secret of ['user_id','identityKeys','private/path','email','phone','qr_token','guest_profile_id','member_profile_id'])expect(wire).not.toContain(secret);
  });
  it('warns when a name search has more than 50 rows per source',async()=>{
    const passes=Array.from({length:51},(_,i)=>pass({id:`p${i}`,user_id:`u${i}`,guest_profile_id:null,full_name:`Jordan Person ${i}`}));
    const data=await loadRoster(database({trial_passes:passes,guest_profiles:[]}),{query:'Jordan',now});
    expect(data.truncated).toBe(true);expect(data.signins.length).toBeLessThanOrEqual(50);
  });
  it('orders multiple words as AND matches and does not treat a percent name as a wildcard',async()=>{
    expect((await loadRoster(database(),{query:'rivera jordan',now})).signins).toHaveLength(1);
    expect((await loadRoster(database(),{query:'%_',now})).signins).toHaveLength(0);
  });
});
