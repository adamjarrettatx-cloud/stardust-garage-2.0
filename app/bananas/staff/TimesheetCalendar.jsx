"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request, time, money } from "@/app/components/time-clock/Shared";
import { chicagoInput, chicagoToIso, duration, elapsedMs, estimateCents } from "@/lib/time-clock/core.mjs";
import { addDays, chicagoYmd, payPeriodEnd, payPeriodLabel, payPeriodStart, PAY_PERIOD_DAYS, weekStart } from "@/lib/time-clock/periods.mjs";

const endpoint = "/api/admin/time-clock";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS = { open: "On shift", pending: "Needs review", approved: "Approved" };

const ymdLabel = (ymd, opts) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${ymd}T12:00:00Z`));
const hours = (ms) => (ms / 3600000).toFixed(2);
const shortHours = (ms) => {
  const h = ms / 3600000;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
};
const firstName = (name) => name.split(/\s+/)[0];
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// Austin wall-clock "YYYY-MM-DDTHH:MM" -> ISO. The repeated fall-back hour
// resolves to its first occurrence; the full detail form offers CDT/CST.
function austinIso(local) {
  try {
    return chicagoToIso(local);
  } catch (e) {
    if (/occurs twice/.test(e.message)) return chicagoToIso(local, "-05:00");
    throw e;
  }
}

/**
 * Payroll calendar for Timesheets: two-week pay periods (Monday through the
 * second Sunday) with daily and pay-period totals. Selecting a day lists every shift with scheduled vs. worked time,
 * one-click approval and an audited inline time correction.
 */
export default function TimesheetCalendar({ workers, onOpenDetail, refreshKey, onChanged }) {
  const today = chicagoYmd();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [shifts, setShifts] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [selected, setSelected] = useState(today);
  const [person, setPerson] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [now, setNow] = useState(Date.now());
  const panel = useRef(null);
  const generation = useRef(0);

  // Whole pay periods only, so no pay period is ever split across the grid edge.
  const gridStart = payPeriodStart(weekStart(`${month}-01`));
  const lastOfMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();
  const gridEnd = payPeriodEnd(payPeriodStart(lastOfMonth));
  const periods = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, PAY_PERIOD_DAYS))
    periods.push(Array.from({ length: PAY_PERIOD_DAYS }, (_, i) => addDays(d, i)));

  const load = useCallback(async () => {
    const id = ++generation.current;
    const range = new URLSearchParams({ from: chicagoToIso(`${gridStart}T00:00`), to: chicagoToIso(`${addDays(gridEnd, 1)}T00:00`) });
    const [sheet, sched] = await Promise.all([
      request(`${endpoint}?${range}`),
      request(`${endpoint}/schedule?${range}`).catch(() => ({ entries: [] })),
    ]);
    if (id !== generation.current) return;
    setShifts(sheet.shifts);
    setSchedule(sched.entries || []);
  }, [gridStart, gridEnd]);

  useEffect(() => {
    setError("");
    load().catch((e) => setError(e.message));
  }, [load, refreshKey]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const name = useCallback((id) => workers.find((w) => w.id === id)?.name || "Staff", [workers]);
  const visible = useMemo(
    () => (shifts || []).filter((s) => person === "all" || s.worker_id === person),
    [shifts, person],
  );
  const visibleSchedule = useMemo(
    () => schedule.filter((e) => person === "all" || e.worker_id === person),
    [schedule, person],
  );
  const byDay = useMemo(() => {
    const map = new Map();
    for (const s of visible) {
      const k = chicagoYmd(s.started_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    for (const list of map.values()) list.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    return map;
  }, [visible]);
  // Scheduled entries with no overlapping punch from the same person.
  const missing = useMemo(() => {
    const map = new Map();
    for (const e of visibleSchedule) {
      // Flag only once the shift is 15 minutes underway.
      if (Date.parse(e.starts_at) + 15 * 60000 > now) continue;
      const a0 = Date.parse(e.starts_at), a1 = Date.parse(e.ends_at);
      const worked = (shifts || []).some(
        (s) => s.worker_id === e.worker_id && overlaps(a0, a1, Date.parse(s.started_at), s.ended_at ? Date.parse(s.ended_at) : now),
      );
      if (worked) continue;
      const k = chicagoYmd(e.starts_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return map;
  }, [visibleSchedule, shifts, now]);

  const inMonth = (d) => d.slice(0, 7) === month;
  // Summary cards follow the pay period of the selected day.
  const periodStart = payPeriodStart(selected);
  const periodEnd = payPeriodEnd(periodStart);
  const inPeriod = (d) => d >= periodStart && d <= periodEnd;
  const periodShifts = visible.filter((s) => inPeriod(chicagoYmd(s.started_at)));
  const periodMs = periodShifts.reduce((n, s) => n + elapsedMs(s, now), 0);
  const periodPay = periodShifts.filter((s) => s.ended_at).reduce((n, s) => n + (estimateCents(s) ?? 0), 0);
  const periodReview = periodShifts.filter((s) => s.ended_at && s.status === "pending").length;
  const periodMissing = [...missing.entries()].filter(([d]) => inPeriod(d)).reduce((n, [, l]) => n + l.length, 0);
  const currentPeriod = payPeriodStart(today);
  const periodName =
    periodStart === currentPeriod ? "Current pay period"
      : periodStart === addDays(currentPeriod, -PAY_PERIOD_DAYS) ? "Prior pay period"
        : "Pay period";

  function pick(d) {
    setSelected(d);
    setEdit(null);
    setNotice("");
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function moveMonth(n) {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
    setMonth(next);
    setShifts(null);
    setEdit(null);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  }
  async function act(fn, message) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const approve = (list) =>
    act(async () => {
      for (const s of list)
        await request(endpoint, { action: "approve", payload: { id: s.id, version: s.version, reason: "" } });
    }, list.length === 1 ? "Shift approved. No payment sent." : `${list.length} shifts approved. No payment sent.`);
  function saveEdit(e) {
    e.preventDefault();
    const s = edit.shift;
    act(async () => {
      const start = edit.start === chicagoInput(s.started_at).slice(0, 16) ? s.started_at : austinIso(edit.start);
      const end = edit.end === chicagoInput(s.ended_at).slice(0, 16) ? s.ended_at : austinIso(edit.end);
      if (Date.parse(end) <= Date.parse(start)) throw new Error("Clock-out must be after clock-in.");
      await request(endpoint, {
        action: "correct",
        payload: { id: s.id, version: s.version, started_at: start, ended_at: end, reason: edit.reason },
      });
      setEdit(null);
    }, "Times corrected. Original punches kept in the activity log; approval reopened.");
  }

  const dayShifts = byDay.get(selected) || [];
  const dayMissing = missing.get(selected) || [];
  const dayWaiting = dayShifts.filter((s) => s.ended_at && s.status === "pending");
  const dayMs = dayShifts.reduce((n, s) => n + elapsedMs(s, now), 0);
  const dayPay = dayShifts.filter((s) => s.ended_at).reduce((n, s) => n + (estimateCents(s) ?? 0), 0);
  const scheduledFor = (s) => {
    const a0 = Date.parse(s.started_at), a1 = s.ended_at ? Date.parse(s.ended_at) : now;
    return schedule.find((e) => e.worker_id === s.worker_id && overlaps(a0, a1, Date.parse(e.starts_at), Date.parse(e.ends_at)));
  };

  return (
    <div className="tcal">
      <div className="tcal-bar">
        <div className="tcal-nav">
          <button aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
          <h2>{ymdLabel(`${month}-01`, { month: "long", year: "numeric" })}</h2>
          <button aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
          {month !== today.slice(0, 7) && (
            <button className="textbtn" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); setShifts(null); }}>
              Today
            </button>
          )}
        </div>
        <label className="tcal-person">
          <span className="sub">Staff</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">Everyone</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="tcal-periodname">
        <span className="eyebrow">{periodName}</span> <span className="mono">{payPeriodLabel(periodStart)}</span>
      </p>
      <div className="metrics tcal-metrics">
        <div className="metric"><span className="sub">Hours</span><b className="mono">{hours(periodMs)}</b></div>
        <div className="metric"><span className="sub">Known base estimate</span><b className="mono">{money(periodPay)}</b></div>
        <div className="metric"><span className="sub">Needs review</span><b className="mono">{periodReview}</b></div>
        <div className="metric"><span className="sub">Scheduled, no clock-in</span><b className="mono">{periodMissing}</b></div>
      </div>

      {error && <div className="notice tc-error" role="alert">{error}</div>}

      <div className="tcal-grid" role="grid" aria-label="Timesheet calendar">
        <div className="tcal-head" role="row">
          {DOW.map((d) => <span key={d} role="columnheader">{d}</span>)}
          <span role="columnheader">Pay period</span>
        </div>
        {!shifts ? (
          <div className="empty" role="status">Loading…</div>
        ) : (
          periods.map((days) => {
            const periodList = days.flatMap((d) => byDay.get(d) || []);
            const totalMs = periodList.reduce((n, s) => n + elapsedMs(s, now), 0);
            const totalPay = periodList.filter((s) => s.ended_at).reduce((n, s) => n + (estimateCents(s) ?? 0), 0);
            const active = days[0] === periodStart;
            return (
              <div className={`tcal-period${active ? " active" : ""}`} role="row" key={days[0]}
                aria-label={`Pay period ${payPeriodLabel(days[0])}`}>
                {days.map((d, i) => {
                  const list = byDay.get(d) || [];
                  const ms = list.reduce((n, s) => n + elapsedMs(s, now), 0);
                  const waiting = list.filter((s) => s.ended_at && s.status === "pending").length;
                  const live = list.some((s) => !s.ended_at);
                  const absent = (missing.get(d) || []).length;
                  const people = [...new Map(list.map((s) => [s.worker_id, s])).values()];
                  return (
                    <button
                      key={d}
                      role="gridcell"
                      aria-selected={d === selected}
                      aria-label={`${ymdLabel(d, { weekday: "long", month: "long", day: "numeric" })}: ${list.length} shifts, ${hours(ms)} hours${waiting ? `, ${waiting} need review` : ""}`}
                      style={{ gridRow: i < 7 ? 1 : 2, gridColumn: (i % 7) + 1 }}
                      className={`tcal-day${inMonth(d) ? "" : " out"}${i >= 7 ? " wk2" : ""}${d === today ? " today" : ""}${d === selected ? " selected" : ""}${list.length ? " has" : ""}`}
                      onClick={() => pick(d)}
                    >
                      <span className="tcal-date">{ymdLabel(d, { day: "numeric" })}</span>
                      {list.length > 0 && <span className="tcal-total mono">{shortHours(ms)}</span>}
                      <span className="tcal-names">
                        {people.slice(0, 3).map((s) => {
                          const own = list.filter((x) => x.worker_id === s.worker_id);
                          return (
                            <span key={s.worker_id}>
                              {firstName(s.worker_name)} <span className="mono">{shortHours(own.reduce((n, x) => n + elapsedMs(x, now), 0))}</span>
                            </span>
                          );
                        })}
                        {people.length > 3 && <span className="sub">+{people.length - 3} more</span>}
                      </span>
                      <span className="tcal-flags">
                        {live && <span className="tcal-flag live">On shift</span>}
                        {waiting > 0 && <span className="tcal-flag review">{waiting} to review</span>}
                        {absent > 0 && <span className="tcal-flag absent">{absent} no clock-in</span>}
                      </span>
                    </button>
                  );
                })}
                <div className="tcal-weektotal tcal-periodtotal" role="gridcell">
                  <span className="sub small">{payPeriodLabel(days[0])}</span>
                  {periodList.length ? (
                    <>
                      <b className="mono">{hours(totalMs)} h</b>
                      <span className="sub mono">{money(totalPay)}</span>
                    </>
                  ) : (
                    <span className="sub">—</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <p className="tablefoot">
        Austin time. Pay periods run two weeks, Monday through the second Sunday. Shifts count on the day they started. Estimates exclude tips,
        taxes and shifts without a rate.
      </p>

      <section className="panel tcal-panel" ref={panel} aria-live="polite">
        <div className="between wrap">
          <div>
            <span className="eyebrow">{selected === today ? "Today" : "Selected day"}</span>
            <h2>{ymdLabel(selected, { weekday: "long", month: "long", day: "numeric" })}</h2>
            <p className="sub">
              {dayShifts.length} shift{dayShifts.length === 1 ? "" : "s"} · {hours(dayMs)} h · {money(dayPay)} est.
            </p>
          </div>
          <div className="row wrap">
            <button aria-label="Previous day" onClick={() => pick(addDays(selected, -1))}>‹ Prev</button>
            <button aria-label="Next day" onClick={() => pick(addDays(selected, 1))}>Next ›</button>
            {dayWaiting.length > 1 && (
              <button className="primary" disabled={busy} onClick={() => approve(dayWaiting)}>
                Approve all {dayWaiting.length}
              </button>
            )}
          </div>
        </div>
        {notice && <div className="notice" role="status">{notice}</div>}

        {!dayShifts.length && !dayMissing.length ? (
          <div className="empty">No hours recorded this day.</div>
        ) : (
          <div className="tcal-rows" role="table" aria-label="Shifts on the selected day">
            <div className="tcal-row tcal-rowhead" role="row">
              <span role="columnheader">Staff</span>
              <span role="columnheader">Scheduled</span>
              <span role="columnheader">Worked</span>
              <span role="columnheader">Hours</span>
              <span role="columnheader">Est. pay</span>
              <span role="columnheader">Status</span>
              <span role="columnheader" />
            </div>
            {dayShifts.map((s) => {
              const plan = scheduledFor(s);
              const cents = estimateCents(s);
              const editing = edit?.shift.id === s.id;
              return (
                <div key={s.id} className={`tcal-entry${editing ? " editing" : ""}`}>
                  <div className="tcal-row" role="row">
                    <span role="cell">
                      <b>{s.worker_name}</b>
                      <span className="cellsub">{[...new Set(s.segments.map((g) => g.role_name))].join(" / ")}
                        {s.breaks.length > 0 && ` · ${s.breaks.length} break${s.breaks.length === 1 ? "" : "s"}`}
                        {s.source === "manager" && " · Added by manager"}</span>
                    </span>
                    <span role="cell" className="mono sub">
                      {plan ? `${time(plan.starts_at)} – ${time(plan.ends_at)}` : "Not scheduled"}
                    </span>
                    <span role="cell" className="mono">
                      {time(s.started_at)} → {s.ended_at ? time(s.ended_at) : "now"}
                    </span>
                    <span role="cell" className="mono">{hours(elapsedMs(s, now))}</span>
                    <span role="cell" className="mono">{s.ended_at ? (cents === null ? "No rate" : money(cents)) : "—"}</span>
                    <span role="cell">
                      <span className={`pill${s.status === "approved" ? "" : s.status === "open" ? " live" : " warning"}`}>
                        {STATUS[s.status]}
                      </span>
                    </span>
                    <span role="cell" className="tcal-actions">
                      {s.ended_at && s.status === "pending" && (
                        <button className="primary" disabled={busy} onClick={() => approve([s])}>Approve</button>
                      )}
                      {s.ended_at && (
                        <button disabled={busy} onClick={() => setEdit(editing ? null : {
                          shift: s,
                          start: chicagoInput(s.started_at).slice(0, 16),
                          end: chicagoInput(s.ended_at).slice(0, 16),
                          reason: "",
                        })}>
                          {editing ? "Close" : "Edit"}
                        </button>
                      )}
                      <button className="textbtn" onClick={() => onOpenDetail(s.id)}>Details</button>
                    </span>
                  </div>
                  {editing && (
                    <form className="tcal-edit" onSubmit={saveEdit}>
                      <label>Clock-in (Austin)
                        <input type="datetime-local" required value={edit.start}
                          onChange={(e) => setEdit({ ...edit, start: e.target.value })} />
                      </label>
                      <label>Clock-out (Austin)
                        <input type="datetime-local" required value={edit.end}
                          onChange={(e) => setEdit({ ...edit, end: e.target.value })} />
                      </label>
                      <label className="tcal-reason">Reason (required)
                        <input required minLength={5} maxLength={2000} value={edit.reason}
                          placeholder="e.g. Forgot to clock out; confirmed with door lead"
                          onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
                      </label>
                      <div className="row">
                        <button className="primary" disabled={busy}>Save correction</button>
                        <button type="button" onClick={() => setEdit(null)}>Cancel</button>
                      </div>
                      <p className="sub small">
                        {(() => {
                          try {
                            const ms = Date.parse(austinIso(edit.end)) - Date.parse(austinIso(edit.start));
                            return ms > 0 ? `New length ${duration(ms)}. ` : "";
                          } catch {
                            return "";
                          }
                        })()}
                        Original punches stay in the activity log. Approval reopens after a correction.
                      </p>
                    </form>
                  )}
                </div>
              );
            })}
            {dayMissing.map((e) => (
              <div key={e.id} className="tcal-row tcal-missing" role="row">
                <span role="cell"><b>{name(e.worker_id)}</b><span className="cellsub">Scheduled</span></span>
                <span role="cell" className="mono sub">{time(e.starts_at)} – {time(e.ends_at)}</span>
                <span role="cell" className="sub">No clock-in</span>
                <span role="cell" className="mono tcal-hide-sm">—</span>
                <span role="cell" className="mono tcal-hide-sm">—</span>
                <span role="cell"><span className="pill warning">Missing</span></span>
                <span role="cell" className="sub small">If they worked, they can send a missed-shift request.</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
