"""Isolated PostgreSQL review via psql. No network or production credentials."""
import concurrent.futures
import json
import subprocess
import uuid
import time

DB = "sdg_timeclock_hardened"
ACTOR = "11111111-1111-4111-8111-111111111111"

def sql(statement, fail=False):
    p = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
         "-d", DB, "-c", statement], capture_output=True, text=True
    )
    if fail:
        return {"ok":p.returncode == 0, "output":p.stdout.strip(), "error":p.stderr.strip()}
    if p.returncode:
        raise RuntimeError(p.stderr)
    lines=[s for s in p.stdout.splitlines() if s not in ("SET","BEGIN","COMMIT")]
    return "\n".join(lines)

def literal(v):
    return "'"+str(v).replace("'","''")+"'"

def rpc(name, *args, failure=False):
    values=[json.dumps(a) if isinstance(a,(dict,list)) else a for a in args]
    return sql("set role service_role; select public."+name+"("+",".join(literal(a) for a in values)+");",fail=failure)

def admin(action, payload):
    return json.loads(rpc("tc_admin",ACTOR,action,payload))

def worker(suffix, active=True):
    p={"name":"Synthetic "+suffix,"category":"employee","active":active,
       "pay_basis":"hourly","flat_cents":None,"pin_lookup":suffix.ljust(64,"p"),
       "pin_verifier":"synthetic-only","roles":[{"role_id":"bartender","rate_cents":2200}]}
    w=admin("save_worker",p)["id"]
    return w,p

def device(suffix,w):
    pairing=suffix.ljust(64,"c")
    token=suffix.ljust(64,"d")
    sess=suffix.ljust(64,"s")
    admin("create_kiosk",{"label":"Synthetic "+suffix,"pairing_hash":pairing})
    rpc("tc_pair",pairing,token)
    version=sql("select credential_version from tc_workers where id="+literal(w))
    rpc("tc_start_session",token,w,version,sess)
    return token,sess

def punch(d,request):
    return rpc("tc_operate",*d,request,"clock_in",{"role_id":"bartender"},failure=True)

def parallel(fn, inputs):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(inputs)) as ex:
        return list(ex.map(fn,inputs))

results={}
results["engine"]=sql("select version()")
results["tables"]=json.loads(sql("""select json_agg(json_build_object(
 'table',c.relname,'rls',c.relrowsecurity,
 'anon_select',has_table_privilege('anon',c.oid,'select'),
 'authenticated_select',has_table_privilege('authenticated',c.oid,'select'),
 'service_insert',has_table_privilege('service_role',c.oid,'insert'),
 'service_select',has_table_privilege('service_role',c.oid,'select')))
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and left(c.relname,3)='tc_'"""))
assert len(results["tables"])==12
assert all(t["rls"] and t["service_select"] and not(t["anon_select"] or t["authenticated_select"] or t["service_insert"]) for t in results["tables"])
results["functions"]=json.loads(sql("""select json_agg(json_build_object(
 'function',p.proname,'anon',has_function_privilege('anon',p.oid,'execute'),
 'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
 'service',has_function_privilege('service_role',p.oid,'execute'),'config',p.proconfig))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and left(p.proname,3)='tc_'"""))
assert len(results["functions"])==10
assert all(not f["anon"] and not f["authenticated"] and f["service"] for f in results["functions"])
results["sequence_acl"]=json.loads(sql("""select json_build_object(
 'anon_usage',has_sequence_privilege('anon','tc_audit_id_seq','usage'),
 'authenticated_update',has_sequence_privilege('authenticated','tc_audit_id_seq','update'),
 'service_update',has_sequence_privilege('service_role','tc_audit_id_seq','update'))"""))
assert not any(results["sequence_acl"].values())
for role in ["anon", "authenticated", "service_role"]:
    assert not sql(f"set role {role}; select nextval('public.tc_audit_id_seq')", fail=True)["ok"]

w,p=worker("duplicate")
d=device("duplicate",w)
key=str(uuid.uuid4())
dups=parallel(lambda _:punch(d,key),range(6))
assert all(r["ok"] for r in dups),dups
ids={json.loads(r["output"].splitlines()[-1])["shift"]["id"] for r in dups}
assert len(ids)==1
assert sql("select count(*) from tc_requests where request_id="+literal(key))=="1"
results["same_request_6_connections"]="PASS: one shift and one request record"

w,p=worker("two-devices")
d1=device("kiosk-one",w)
d2=device("kiosk-two",w)
race=parallel(lambda d:punch(d,str(uuid.uuid4())),[d1,d2])
assert sum(r["ok"] for r in race)==1,race
assert any("shift_already_open" in r["error"] for r in race)
results["different_devices_same_worker"]="PASS: one success, one shift_already_open"

limits=parallel(lambda _:rpc("tc_take_limit","concurrent-limit",3,60),range(8))
assert limits.count("t")==3,limits
results["concurrent_rate_limit"]="PASS: exactly three of eight attempts allowed"

# Regression assertions for the three rollout-review findings.
w,p=worker("inactive-new",False)
results["inactive_creation_actual"]=sql("select active from tc_workers where id="+literal(w))
assert results["inactive_creation_actual"]=="f"
w,p=worker("reactivate")
d=device("reactivate",w)
admin("save_worker",{**p,"id":w,"active":False})
results["session_while_inactive"]=json.loads(rpc("tc_state",*d,False))["authenticated"]
admin("save_worker",{**p,"id":w,"active":True})
results["old_session_after_reactivation"]=json.loads(rpc("tc_state",*d,False))["authenticated"]
assert results["session_while_inactive"] is False
assert results["old_session_after_reactivation"] is False
version=sql("select credential_version from tc_workers where id="+literal(w))
rpc("tc_start_session",d[0],w,version,d[1])
assert json.loads(rpc("tc_state",*d,False))["authenticated"] is True
results["fresh_session_after_reactivation"]="PASS"

def transaction(statements):
    """Hold a real transaction open until the test explicitly releases it."""
    proc=subprocess.Popen(["sudo","-u","postgres","psql","-XAt","-v","ON_ERROR_STOP=1","-d",DB],
                          stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    proc.stdin.write("begin; "+statements+"; select 'TEST_LOCK_HELD';\n")
    proc.stdin.flush()
    while True:
        line=proc.stdout.readline()
        if line.strip()=="TEST_LOCK_HELD":
            return proc
        if not line:
            raise RuntimeError(proc.stderr.read())

def release(proc,statements=""):
    out,err=proc.communicate(statements+"; commit;\n",timeout=10)
    assert proc.returncode==0,(out,err)

def await_lock_wait():
    # Observe a real lock wait, not a fixed sleep pretending to prove a race.
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        if int(sql("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")):
            return
    raise AssertionError("Expected blocked database connection")

# Deactivation wins the worker lock: the waiting punch must be denied.
w,p=worker("disable-first")
d=device("disable-first",w)
hold=transaction("select id from tc_workers where id="+literal(w)+" for update")
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
    pending=ex.submit(punch,d,str(uuid.uuid4()))
    try:
        await_lock_wait()
        payload=literal(json.dumps({**p,"id":w,"active":False}))
        release(hold,"select tc_admin("+literal(ACTOR)+",'save_worker',"+payload+")")
    finally:
        if hold.poll() is None:
            release(hold)
    denied=pending.result(timeout=10)
assert not denied["ok"] and "not_authorized" in denied["error"],denied
assert sql("select count(*) from tc_shifts where worker_id="+literal(w))=="0"
results["deactivation_before_waiting_punch"]="PASS: denied, no shift inserted"

# A punch wins the lock: retain its time, then disable access.
w,p=worker("punch-first")
d=device("punch-first",w)
args=[*d,str(uuid.uuid4()),"clock_in",json.dumps({"role_id":"bartender"})]
hold=transaction("set role service_role; select tc_operate("+",".join(literal(a) for a in args)+")")
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
    pending=ex.submit(admin,"save_worker",{**p,"id":w,"active":False})
    try:
        await_lock_wait()
        release(hold)
    finally:
        if hold.poll() is None:
            release(hold)
    pending.result(timeout=10)
assert sql("select count(*) from tc_shifts where worker_id="+literal(w)+" and ended_at is null")=="1"
assert json.loads(rpc("tc_state",*d,False))["authenticated"] is False
results["punch_before_waiting_deactivation"]="PASS: shift retained, access revoked"

results["anon_rpc_denied"]=not sql("set role anon; select tc_cleanup()",fail=True)["ok"]
results["authenticated_table_denied"]=not sql("set role authenticated; select * from tc_workers",fail=True)["ok"]
results["service_direct_write_denied"]=not sql("set role service_role; update tc_workers set name='tamper'",fail=True)["ok"]
results["audit_update_denied"]=not sql("update tc_audit set action='tamper'",fail=True)["ok"]
print(json.dumps(results,indent=2))
