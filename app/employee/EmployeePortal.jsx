"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Frame, request, time, money } from "@/app/components/time-clock/Shared";
import { createClient } from "@/lib/supabase/client";
import { chicagoInput, chicagoToIso, duration, elapsedMs, estimateCents } from "@/lib/time-clock/core.mjs";
import { addDays, chicagoYmd, dayStartIso, weekStart } from "@/lib/time-clock/periods.mjs";

const TZ = "America/Chicago";
const fmt = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });
const dayLong = (iso) => fmt({ weekday: "long", month: "short", day: "numeric" }).format(new Date(iso));
const dayShort = (iso) => fmt({ weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
const ymdLabel = (ymd, opts) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${ymd}T12:00:00Z`));
const shortTime = (iso) =>
  fmt({ hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "").replace(" ", "").toLowerCase();
const hours = (ms) => (ms / 3600000).toFixed(2);
const span = (a, b) => `${time(a)} – ${time(b)}`;

const KIND_LABEL = { edit_shift: "Hours fix", missed_shift: "Missed shift", time_off: "Time off" };
const STATUS_LABEL = { pending: "Waiting for manager", approved: "Approved", denied: "Declined", cancelled: "Cancelled" };
const SHIFT_STATUS = { open: "On the clock", pending: "Awaiting review", approved: "Approved" };

// Austin wall-clock input -> ISO. The repeated fall-back hour defaults to its
// first occurrence (CDT); every other invalid value surfaces a message.
function austinIso(local) {
  try {
    return chicagoToIso(local);
  } catch (e) {
    if (/occurs twice/.test(e.message)) return chicagoToIso(local, "-05:00");
    throw e;
  }
}
const localValue = (iso) => chicagoInput(iso).slice(0, 16);

export default function EmployeePortal({ enabled }) {
  const today = chicagoYmd();
  const [tab, setTab] = useState("schedule");
  const [week, setWeek] = useState(weekStart(today));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await request(`/api/employee/me?from=${week}&to=${addDays(week, 6)}`));
    } catch (e) {
      if (e.status === 401) window.location.replace("/employee/login");
      else setError(e.message);
    }
  }, [week]);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function signOut() {
    await fetch("/api/employee/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.replace("/employee/login");
  }

  const pendingCount = data ? data.requests.filter((r) => r.status === "pending").length : 0;
  const tabs = [
    ["schedule", "Schedule"],
    ["timesheet", "Timesheet"],
    ["requests", pendingCount ? `Requests (${pendingCount})` : "Requests"],
    ["account", "Account"],
  ];

  return (
    <Frame owner>
      <div className="emp">
        <div className="emp-head">
          <div>
            <span className="eyebrow">Stardust Garage · Staff</span>
            <h1>{data ? data.worker.name : "My schedule"}</h1>
          </div>
          <button className="textbtn" onClick={signOut}>Sign out</button>
        </div>
        <nav className="tabs emp-tabs" aria-label="Employee sections">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        {!enabled ? (
          <div className="notice">Staff tools are not enabled yet.</div>
        ) : error ? (
          <div className="notice tc-error" role="alert">
            {error}
            <button onClick={load}>Retry</button>
          </div>
        ) : !data ? (
          <div className="empty" role="status">Loading…</div>
        ) : tab === "schedule" ? (
          <ScheduleTab data={data} now={now} today={today} onTimeOff={() => setModal({ kind: "time_off" })} />
        ) : tab === "timesheet" ? (
          <TimesheetTab data={data} now={now} week={week} today={today} setWeek={setWeek}
            onFix={(shift) => setModal({ kind: "edit_shift", shift })}
            onMissed={() => setModal({ kind: "missed_shift" })} />
        ) : tab === "requests" ? (
          <RequestsTab data={data} onNew={(kind) => {
              if (kind !== "edit_shift") return setModal({ kind });
              setTab("timesheet");
              setToast("Choose the shift to fix, then tap Request fix.");
            }}
            onCancel={async (r) => {
              if (!window.confirm("Cancel this request?")) return;
              try {
                await request("/api/employee/requests", { action: "cancel", id: r.id });
                setToast("Request cancelled.");
                load();
              } catch (e) {
                setToast(e.message);
              }
            }} />
        ) : (
          <AccountTab data={data} />
        )}

        {modal && data && (
          <RequestForm modal={modal} data={data} today={today} onClose={() => setModal(null)}
            onSent={(message) => { setModal(null); setToast(message); setTab("requests"); load(); }} />
        )}
        {toast && <div className="emp-toast" role="status">{toast}</div>}
      </div>
    </Frame>
  );
}

function ScheduleTab({ data, now, today, onTimeOff }) {
  const upcoming = data.schedule.filter((s) => Date.parse(s.ends_at) >= now);
  const next = upcoming[0];
  const open = data.shifts.find((s) => !s.ended_at);
  const timeOff = data.requests.filter((r) => r.kind === "time_off" && r.status === "approved" && Date.parse(r.applied_end) > now);
  const thisWeek = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(thisWeek, i));
  const dayOf = (iso) => chicagoYmd(iso);
  const weekAheadMs = upcoming
    .filter((s) => Date.parse(s.starts_at) < now + 7 * 86400000)
    .reduce((sum, s) => sum + Date.parse(s.ends_at) - Math.max(now, Date.parse(s.starts_at)), 0);

  // Group upcoming shifts by their Monday week.
  const groups = [];
  for (const s of upcoming) {
    const key = weekStart(dayOf(s.starts_at));
    if (!groups.length || groups.at(-1).key !== key) groups.push({ key, items: [] });
    groups.at(-1).items.push(s);
  }

  return (
    <>
      <div className="emp-next">
        <section className="panel emp-hero">
          <span className="eyebrow">{open ? "On the clock" : "Next shift"}</span>
          {open ? (
            <>
              <p className="emp-big"><span className="pill live">Since {time(open.started_at)}</span></p>
              <p>{duration(elapsedMs(open, now))} so far{open.segments.at(-1) && ` · ${open.segments.at(-1).role_name}`}</p>
              <p className="sub">Clock out on the front-room iPad.</p>
            </>
          ) : next ? (
            <>
              <p className="emp-big">{dayLong(next.starts_at)}</p>
              <p className="emp-time mono">{span(next.starts_at, next.ends_at)}</p>
              <p><b>{next.role_name}</b> · {duration(Date.parse(next.ends_at) - Date.parse(next.starts_at))}</p>
              {next.note && <p className="sub tc-preserve">{next.note}</p>}
              {next.crew.length > 0 && (
                <p className="sub">Working with {next.crew.map((c) => `${c.name} (${c.role_name})`).join(", ")}</p>
              )}
            </>
          ) : (
            <p className="emp-big">No upcoming shifts</p>
          )}
        </section>
        <section className="panel">
          <span className="eyebrow">Next 7 days</span>
          <p className="emp-big mono">{hours(weekAheadMs)} h</p>
          <p className="sub">{upcoming.filter((s) => Date.parse(s.starts_at) < now + 7 * 86400000).length} scheduled shifts</p>
          <button className="wide" onClick={onTimeOff}>Request time off</button>
        </section>
      </div>

      <section className="emp-section">
        <h2>This week</h2>
        <div className="emp-week" role="list">
          {days.map((d) => {
            const items = data.schedule.filter((s) => dayOf(s.starts_at) === d);
            const off = timeOff.some((r) => dayOf(r.applied_start) <= d && d < dayOf(r.applied_end));
            return (
              <div key={d} role="listitem" className={`emp-day${d === today ? " today" : ""}${items.length ? " has" : ""}`}>
                <span className="emp-dow">{ymdLabel(d, { weekday: "short" })}</span>
                <span className="emp-dom mono">{ymdLabel(d, { day: "numeric" })}</span>
                {items.map((s) => (
                  <span key={s.id} className="emp-chip">
                    <b>{shortTime(s.starts_at)}</b>
                    <span>{s.role_name}</span>
                  </span>
                ))}
                {off && <span className="emp-chip off">Time off</span>}
                {!items.length && !off && <span className="emp-none">Off</span>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="emp-section">
        <h2>Upcoming</h2>
        {!groups.length && !timeOff.length ? (
          <div className="panel empty">No shifts scheduled yet. Your manager will post them here.</div>
        ) : (
          <>
            {timeOff.map((r) => (
              <div key={r.id} className="panel emp-row">
                <div>
                  <b>Time off</b>
                  <span className="cellsub">{dayShort(r.applied_start)} – {dayShort(new Date(Date.parse(r.applied_end) - 1).toISOString())}</span>
                </div>
                <span className="pill">Approved</span>
              </div>
            ))}
            {groups.map((g) => (
              <div key={g.key} className="emp-group">
                <span className="eyebrow">Week of {ymdLabel(g.key, { month: "short", day: "numeric" })}</span>
                <div className="panel">
                  <ul className="emp-list">
                    {g.items.map((s) => (
                      <li key={s.id}>
                        <div>
                          <b>{dayLong(s.starts_at)}</b>
                          <span className="cellsub">
                            {s.role_name}
                            {s.crew.length > 0 && ` · with ${s.crew.map((c) => c.name).join(", ")}`}
                          </span>
                          {s.note && <span className="cellsub tc-preserve">{s.note}</span>}
                        </div>
                        <span className="mono emp-right">
                          {span(s.starts_at, s.ends_at)}
                          <span className="cellsub">{duration(Date.parse(s.ends_at) - Date.parse(s.starts_at))}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}

function TimesheetTab({ data, now, week, today, setWeek, onFix, onMissed }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const shifts = data.shifts.filter((s) => {
    const d = chicagoYmd(s.started_at);
    return d >= week && d <= days[6];
  });
  const pendingFix = new Set(data.requests.filter((r) => r.kind === "edit_shift" && r.status === "pending").map((r) => r.shift_id));
  const workedMs = shifts.reduce((sum, s) => sum + elapsedMs(s, now), 0);
  const scheduledMs = data.schedule
    .filter((s) => { const d = chicagoYmd(s.starts_at); return d >= week && d <= days[6]; })
    .reduce((sum, s) => sum + Date.parse(s.ends_at) - Date.parse(s.starts_at), 0);
  const pay = shifts.filter((s) => s.ended_at).map(estimateCents);
  const known = pay.filter((c) => c !== null).reduce((a, b) => a + b, 0);
  const missing = pay.filter((c) => c === null).length;
  const approved = shifts.filter((s) => s.status === "approved").length;
  const isCurrent = week === weekStart(today);

  return (
    <>
      <div className="emp-period">
        <button aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>‹</button>
        <div>
          <span className="eyebrow">{isCurrent ? "This week" : "Pay week"}</span>
          <b>{ymdLabel(week, { month: "short", day: "numeric" })} – {ymdLabel(days[6], { month: "short", day: "numeric", year: "numeric" })}</b>
        </div>
        <button aria-label="Next week" disabled={isCurrent} onClick={() => setWeek(addDays(week, 7))}>›</button>
      </div>

      <div className="metrics">
        <div className="metric"><span className="sub">Hours worked</span><b className="mono">{hours(workedMs)}</b></div>
        <div className="metric"><span className="sub">Scheduled</span><b className="mono">{hours(scheduledMs)}</b></div>
        <div className="metric"><span className="sub">Est. base pay</span><b className="mono">{money(known)}</b></div>
        <div className="metric"><span className="sub">Approved</span><b className="mono">{approved}/{shifts.length}</b></div>
      </div>

      <div className="emp-sheet" role="table" aria-label="Timesheet">
        <div className="emp-sheet-head" role="row">
          <span role="columnheader">Day</span><span role="columnheader">Role</span>
          <span role="columnheader">In → Out</span><span role="columnheader">Hours</span>
          <span role="columnheader">Est. pay</span><span role="columnheader">Status</span><span role="columnheader" />
        </div>
        {days.map((d) => {
          const dayShifts = shifts.filter((s) => chicagoYmd(s.started_at) === d);
          if (!dayShifts.length)
            return (
              <div key={d} role="row" className={`emp-sheet-row empty-day${d === today ? " today" : ""}`}>
                <span role="cell"><b>{ymdLabel(d, { weekday: "short" })}</b> {ymdLabel(d, { month: "short", day: "numeric" })}</span>
                <span role="cell" className="sub">—</span>
              </div>
            );
          return dayShifts.map((s) => {
            const cents = estimateCents(s);
            const flagged = pendingFix.has(s.id);
            return (
              <div key={s.id} role="row" className={`emp-sheet-row${d === today ? " today" : ""}`}>
                <span role="cell"><b>{ymdLabel(d, { weekday: "short" })}</b> {ymdLabel(d, { month: "short", day: "numeric" })}</span>
                <span role="cell">{[...new Set(s.segments.map((g) => g.role_name))].join(" / ")}
                  {s.breaks.length > 0 && <span className="cellsub">{s.breaks.length} break{s.breaks.length === 1 ? "" : "s"} (paid)</span>}
                  {s.source === "manager" && <span className="cellsub">Added by manager</span>}
                </span>
                <span role="cell" className="mono">{time(s.started_at)} → {s.ended_at ? time(s.ended_at) : "now"}</span>
                <span role="cell" className="mono">{hours(elapsedMs(s, now))}</span>
                <span role="cell" className="mono">{s.ended_at ? (cents === null ? "—" : money(cents)) : "—"}</span>
                <span role="cell">
                  <span className={`pill${s.status === "approved" ? "" : s.status === "open" ? " live" : " warning"}`}>
                    {flagged ? "Fix requested" : SHIFT_STATUS[s.status]}
                  </span>
                </span>
                <span role="cell" className="emp-act">
                  {s.ended_at && !flagged && <button onClick={() => onFix(s)}>Request fix</button>}
                </span>
              </div>
            );
          });
        })}
      </div>
      <div className="between wrap emp-sheet-foot">
        <p className="tablefoot">
          Base pay estimate before tips, taxes and deductions. Final pay comes from payroll.
          {missing > 0 && ` ${missing} shift${missing === 1 ? "" : "s"} without a rate not included.`}
        </p>
        <button onClick={onMissed}>Add a missed shift</button>
      </div>
    </>
  );
}

function RequestsTab({ data, onNew, onCancel }) {
  const list = data.requests;
  return (
    <>
      <div className="emp-actions">
        <button onClick={() => onNew("edit_shift")}><b>Fix my hours</b><span className="cellsub">Wrong clock-in or clock-out</span></button>
        <button onClick={() => onNew("missed_shift")}><b>Add a missed shift</b><span className="cellsub">Worked but did not clock in</span></button>
        <button onClick={() => onNew("time_off")}><b>Request time off</b><span className="cellsub">Days you can&rsquo;t work</span></button>
      </div>
      <section className="emp-section">
        <h2>My requests</h2>
        {!list.length ? (
          <div className="panel empty">No requests yet.</div>
        ) : (
          list.map((r) => (
            <div key={r.id} className="panel emp-req">
              <div className="between">
                <b>{KIND_LABEL[r.kind]}</b>
                <span className={`pill${r.status === "pending" ? " warning" : ""}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <RequestSummary r={r} />
              <p className="sub tc-preserve">&ldquo;{r.reason}&rdquo;</p>
              {r.manager_note && <p className="emp-note tc-preserve"><span className="eyebrow">Manager</span> {r.manager_note}</p>}
              <div className="between">
                <span className="cellsub">Sent {dayShort(r.created_at)}</span>
                {r.status === "pending" && <button className="textbtn" onClick={() => onCancel(r)}>Cancel request</button>}
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function RequestSummary({ r }) {
  const start = r.applied_start || r.requested_start;
  const end = r.applied_end || r.requested_end;
  if (r.kind === "time_off")
    return <p className="mono">{dayShort(start)} – {dayShort(new Date(Date.parse(end) - 1).toISOString())}</p>;
  if (r.kind === "missed_shift")
    return <p className="mono">{dayShort(start)} · {span(start, end)} · {r.role_name}</p>;
  return (
    <p className="mono">
      {dayShort(r.original_start)}: <s>{span(r.original_start, r.original_end)}</s> → {span(start, end)}
    </p>
  );
}

function AccountTab({ data }) {
  const [pw, setPw] = useState(null);
  const [msg, setMsg] = useState("");
  const w = data.worker;
  async function changePassword(e) {
    e.preventDefault();
    setMsg("");
    if (pw.next.length < 10) return setMsg("Use at least 10 characters.");
    if (pw.next !== pw.confirm) return setMsg("The passwords do not match.");
    const { error: err } = await createClient().auth.updateUser({ password: pw.next });
    if (err) return setMsg(err.message || "Could not change the password.");
    setPw(null);
    setMsg("Password changed.");
  }
  return (
    <div className="emp-account">
      <section className="panel">
        <span className="eyebrow">Profile</span>
        <dl className="emp-dl">
          <dt>Name</dt><dd>{w.name}</dd>
          {w.username && (<><dt>Username</dt><dd>{w.username}</dd></>)}
          <dt>Classification</dt><dd>{w.category === "contractor" ? "Contractor" : "Employee"}</dd>
          <dt>Pay</dt>
          <dd className="emp-rates">
            {w.pay_basis === "flat" ? (
              <span className="pill">{money(w.flat_cents)} / shift</span>
            ) : w.pay_basis === "hourly" ? (
              data.roles.map((r) => (
                <span className="pill" key={r.id}>{r.name} · {r.rate_cents === null ? "not set" : `${money(r.rate_cents)}/hr`}</span>
              ))
            ) : (
              <span className="sub">Not set yet</span>
            )}
          </dd>
        </dl>
        <p className="sub">Clock in and out on the front-room iPad with your PIN. Ask a manager to change your rate or roles.</p>
      </section>
      <section className="panel">
        <span className="eyebrow">Security</span>
        {msg && <div className="notice" role="status">{msg}</div>}
        {pw ? (
          <form className="tc-form" onSubmit={changePassword}>
            <label>New password
              <input type="password" autoComplete="new-password" minLength={10} maxLength={72} required
                value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </label>
            <label>Confirm new password
              <input type="password" autoComplete="new-password" minLength={10} maxLength={72} required
                value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            <div className="row wrap">
              <button className="primary">Save password</button>
              <button type="button" onClick={() => setPw(null)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setPw({ next: "", confirm: "" })}>Change password</button>
        )}
      </section>
    </div>
  );
}

function RequestForm({ modal, data, today, onClose, onSent }) {
  const { kind, shift } = modal;
  const [form, setForm] = useState(() =>
    kind === "edit_shift"
      ? { start: localValue(shift.started_at), end: localValue(shift.ended_at), reason: "" }
      : kind === "missed_shift"
        ? { day: today, from: "20:00", to: "02:00", role_id: data.roles[0]?.id || "", reason: "" }
        : { first: addDays(today, 1), last: addDays(today, 1), reason: "" },
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const preview = useMemo(() => {
    try {
      if (kind === "edit_shift") {
        const a = austinIso(form.start), b = austinIso(form.end);
        return Date.parse(b) > Date.parse(a) ? duration(Date.parse(b) - Date.parse(a)) : null;
      }
      if (kind === "missed_shift") {
        const endDay = form.to <= form.from ? addDays(form.day, 1) : form.day;
        const a = austinIso(`${form.day}T${form.from}`), b = austinIso(`${endDay}T${form.to}`);
        return duration(Date.parse(b) - Date.parse(a));
      }
      if (form.last < form.first) return null;
      const n = Math.round((Date.parse(`${form.last}T00:00:00Z`) - Date.parse(`${form.first}T00:00:00Z`)) / 86400000) + 1;
      return `${n} day${n === 1 ? "" : "s"}`;
    } catch {
      return null;
    }
  }, [form, kind]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    let payload;
    try {
      if (kind === "edit_shift") {
        payload = { kind, shift_id: shift.id, starts_at: austinIso(form.start), ends_at: austinIso(form.end) };
      } else if (kind === "missed_shift") {
        const endDay = form.to <= form.from ? addDays(form.day, 1) : form.day;
        payload = { kind, role_id: form.role_id, starts_at: austinIso(`${form.day}T${form.from}`), ends_at: austinIso(`${endDay}T${form.to}`) };
      } else {
        if (form.last < form.first) throw new Error("The last day must be on or after the first day.");
        payload = { kind, starts_at: dayStartIso(form.first), ends_at: dayStartIso(addDays(form.last, 1)) };
      }
    } catch (x) {
      return setErr(x.message);
    }
    setBusy(true);
    try {
      await request("/api/employee/requests", { action: "create", ...payload, reason: form.reason });
      onSent(kind === "time_off" ? "Time-off request sent to your manager." : "Request sent to your manager.");
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  const title = kind === "edit_shift" ? "Fix my hours" : kind === "missed_shift" ? "Add a missed shift" : "Request time off";
  return (
    <div className="tc-confirm" role="dialog" aria-modal="true" aria-labelledby="emp-form-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="panel tc-form emp-form" onSubmit={submit}>
        <h2 id="emp-form-title">{title}</h2>
        {kind === "edit_shift" && (
          <>
            <p className="sub">Recorded: {dayShort(shift.started_at)}, {span(shift.started_at, shift.ended_at)}</p>
            <label>Correct clock-in
              <input type="datetime-local" required value={form.start} onChange={set("start")} />
            </label>
            <label>Correct clock-out
              <input type="datetime-local" required value={form.end} onChange={set("end")} />
            </label>
          </>
        )}
        {kind === "missed_shift" && (
          <>
            <label>Role
              <select required value={form.role_id} onChange={set("role_id")}>
                {data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label>Date you started
              <input type="date" required max={today} value={form.day} onChange={set("day")} />
            </label>
            <div className="emp-two">
              <label>Start<input type="time" required value={form.from} onChange={set("from")} /></label>
              <label>End<input type="time" required value={form.to} onChange={set("to")} /></label>
            </div>
            {form.to <= form.from && <p className="sub">Ends the next morning.</p>}
          </>
        )}
        {kind === "time_off" && (
          <div className="emp-two">
            <label>First day off<input type="date" required min={today} value={form.first} onChange={set("first")} /></label>
            <label>Last day off<input type="date" required min={form.first} value={form.last} onChange={set("last")} /></label>
          </div>
        )}
        {preview && <p className="emp-preview mono">{preview}</p>}
        <label>Reason for your manager
          <textarea required minLength={3} maxLength={500} value={form.reason} onChange={set("reason")}
            placeholder={kind === "time_off" ? "e.g. Family trip" : "e.g. The iPad was offline when I arrived"} />
        </label>
        {err && <div className="notice tc-error" role="alert">{err}</div>}
        <div className="row wrap">
          <button className="primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
