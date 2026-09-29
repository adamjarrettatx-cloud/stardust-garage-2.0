import { describe,expect,it } from 'vitest';
import { accessStatus,restrictionGuard,resolveAccessIdentity } from '@/lib/capacity/access-restrictions';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const subject={kind:'member',id:id(1)};
const warning={id:id(10),action:'warning',category:'photography',note:'A factual warning',created_at:'2026-09-26',actor_label:'Test staff'};
function db({incidents=[warning],reminders=[],restrictions=[],fail=null,linkedPass=false}={}){
  return {from(table){
    let overlap=null,condition=null;
    const q={
      select:()=>q,order:()=>q,limit:()=>q,eq:(f,v)=>{condition=[f,v];return q},
      in:(f,v)=>{condition=[f,v];return q},overlaps:(f,v)=>{overlap=[f,v];return q},
      single:async()=>({data:{id:id(1),full_name:'Test Guest',user_id:id(2)}}),maybeSingle:async()=>({data:null}),
      then(resolve,reject){
        if(table===fail)return Promise.resolve({error:{message:'offline'}}).then(resolve,reject);
        let data=[];
        if(table==='security_incidents')data=incidents;
        if(table==='security_warning_reminders')data=reminders;
        if(table==='access_restrictions')data=restrictions.filter(r=>r[overlap[0]].some(k=>overlap[1].includes(k)));
        if(table==='trial_passes'&&linkedPass&&condition?.[0]==='member_profile_id')data=[{id:id(3),member_profile_id:id(1),user_id:id(2),guest_profile_id:id(4)}];
        return Promise.resolve({data}).then(resolve,reject);
      },
    };return q;
  }};
}
describe('incident admission guard',()=>{
  it('holds admission for warnings even when there is no restriction',async()=>{
    const access=await accessStatus(db(),subject);expect(access.status).toBe('clear');expect(access.pending_reminders).toHaveLength(1);
    const res=await restrictionGuard(db(),subject);expect(res.status).toBe(409);expect((await res.json()).code).toBe('security_reminder_required');
  });
  it('acknowledgment permits admission but never clears history',async()=>{
    const database=db({reminders:[{incident_ids:[warning.id]}]});
    expect(await restrictionGuard(database,subject)).toBeNull();
    expect((await accessStatus(database,subject)).incidents).toHaveLength(1);
  });
  it('a new warning after acknowledgment requires another reminder',async()=>{
    const database=db({incidents:[warning,{...warning,id:id(11)}],reminders:[{incident_ids:[warning.id]}]});
    expect((await accessStatus(database,subject)).pending_reminders.map(r=>r.id)).toEqual([id(11)]);
    expect((await restrictionGuard(database,subject)).status).toBe(409);
  });
  it('a reminder cannot bypass a confirmed ban',async()=>{
    const database=db({reminders:[{incident_ids:[warning.id]}],restrictions:[{id:id(20),identity_keys:[`member:${id(1)}`],match_keys:[],full_name:'Test Guest',reason:'Ban',kind:'banned'}]});
    expect((await restrictionGuard(database,subject)).status).toBe(403);
  });
  it('follows explicit reverse links so another credential cannot bypass a restriction',async()=>{
    const database=db({linkedPass:true,restrictions:[{id:id(20),identity_keys:[`guest:${id(4)}`],match_keys:[],full_name:'Test Guest',reason:'Ban',kind:'banned'}]});
    const identity=await resolveAccessIdentity(database,subject);expect(identity.identity_keys).toContain(`trial_pass:${id(3)}`);
    expect((await restrictionGuard(database,subject)).status).toBe(403);
  });
  it('fails closed when incident history, reminder history or identity expansion cannot be read',async()=>{
    for(const fail of ['security_incidents','security_warning_reminders','trial_passes']){
      expect((await restrictionGuard(db({fail}),subject)).status).toBe(503);
    }
  });
  it('unlinked names cannot inherit another persons incident',async()=>{
    // Unlike manual restrictions, history lookup has no name/contact matching.
    const database=db({incidents:[]});
    expect(await restrictionGuard(database,subject)).toBeNull();
  });
});
