"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request, time } from "@/app/components/time-clock/Shared";
import { chicagoInput, chicagoToIso, duration } from "@/lib/time-clock/core.mjs";
import { austinShiftRange, scheduledHours } from "@/lib/time-clock/schedule.mjs";

const endpoint = "/api/admin/time-clock/schedule";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Same rolling-window model as the Events Calendar: the grid begins on the
// Sunday of the current week and runs forward one year in month segments.
const WINDOW_DAYS = 365;
const ROLE_COLORS = ["#d9c48c", "#10b981", "#f59e0b", "#e11d48", "#6366f1", "#0ea5e9", "#a855f7", "#84cc16"];

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const austinDay = (iso) => chicagoInput(iso).slice(0, 10);
const austinTime = (iso) => chicagoInput(iso).slice(11, 16);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fromKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shortTime = (iso) => time(iso).replace(":00", "").replace(" ", "").toLowerCase();

export default function ScheduleCalendar({ workers, roles, assignments }) {
  const today = useMemo(() => {
    const k = austinDay(new Date().toISOString());
    return fromKey(k);
  }, []);
  const gridStart = useMemo(() => addDays(today, -today.getDay()), [today]);
  const windowEnd = useMemo(() => addDays(today, WINDOW_DAYS - 1), [today]);
  const gridEnd = useMemo(() => addDays(windowEnd, 6 - windowEnd.getDay()), [windowEnd]);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // A day is always selected so the detail panel never appears mid
  // double-click and shifts the grid under the pointer.
  const [selected, setSelected] = useState(() => austinDay(new Date().toISOString()));
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const mutex = useRef(false);

  const roleName = useCallback((id) => roles.find((r) => r.id === id)?.name || id, [roles]);
  const workerName = useCallback((id) => workers.find((w) => w.id === id)?.name || "Unknown", [workers]);
  const roleColor = useCallback(
    (id) => ROLE_COLORS[Math.max(0, roles.findIndex((r) => r.id === id)) % ROLE_COLORS.length],
    [roles],
  );
  const assignedRoles = useCallback(
    (workerId) =>
      assignments
        .filter((a) => a.worker_id === workerId)
        .map((a) => roles.find((r) => r.id === a.role_id))
        .filter((r) => r && r.active),
    [assignments, roles],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      from: chicagoToIso(`${dayKey(gridStart)}T00:00`),
      to: chicagoToIso(`${dayKey(addDays(gridEnd, 1))}T00:00`),
    });
    const data = await request(`${endpoint}?${params}`);
    setEntries(data.entries);
  }, [gridStart, gridEnd]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of entries || []) {
      const k = austinDay(e.starts_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    for (const list of map.values())
      list.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || workerName(a.worker_id).localeCompare(workerName(b.worker_id)));
    return map;
  }, [entries, workerName]);

  const segments = useMemo(() => {
    const out = [];
    let m = new Date(gridStart.getFullYear(), gridStart.getMonth(), 1);
    if (m < new Date(today.getFullYear(), today.getMonth(), 1)) m = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
    for (; m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const first = new Date(m.getFullYear(), m.getMonth(), 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      let s = addDays(first, -first.getDay());
      if (s < gridStart) s = gridStart;
      let e = addDays(end, 6 - end.getDay());
      if (e > gridEnd) e = gridEnd;
      const cells = [];
      for (let d = s; d <= e; d = addDays(d, 1)) cells.push(d);
      out.push({ year: m.getFullYear(), month: m.getMonth(), cells });
    }
    return out;
  }, [gridStart, gridEnd, today, windowEnd]);

  // Weekly scheduled-hours summary for the current Sun–Sat week.
  const weekSummary = useMemo(() => {
    const start = dayKey(gridStart), end = dayKey(addDays(gridStart, 7));
    const totals = new Map();
    for (const e of entries || []) {
      const k = austinDay(e.starts_at);
      if (k < start || k >= end) continue;
      totals.set(e.worker_id, (totals.get(e.worker_id) || 0) + scheduledHours([e]));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries, gridStart]);

  async function run(fn) {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }

  function openCreate(day) {
    const k = dayKey(day);
    setSelected(k);
    setModal({ mode: "create", day: k, start: "20:00", end: "02:00", note: "", people: {} });
  }
  function openEdit(e) {
    setModal({
      mode: "edit",
      id: e.id,
      version: e.version,
      day: austinDay(e.starts_at),
      start: austinTime(e.starts_at),
      end: austinTime(e.ends_at),
      note: e.note || "",
      worker_id: e.worker_id,
      role_id: e.role_id,
    });
  }

  function save(ev) {
    ev.preventDefault();
    run(async () => {
      const range = austinShiftRange(modal.day, modal.start, modal.end, chicagoToIso);
      if (modal.mode === "create") {
        const people = Object.entries(modal.people);
        if (!people.length) throw new Error("Select at least one person.");
        const result = await request(endpoint, {
          action: "create",
          payload: {
            entries: people.map(([worker_id, role_id]) => ({ worker_id, role_id, ...range, note: modal.note })),
          },
        });
        setNotice(`${result.count} ${result.count === 1 ? "shift" : "shifts"} scheduled.`);
      } else {
        await request(endpoint, {
          action: "update",
          payload: { id: modal.id, version: modal.version, worker_id: modal.worker_id, role_id: modal.role_id, ...range, note: modal.note },
        });
        setNotice("Scheduled shift updated.");
      }
      setSelected(modal.day);
      setModal(null);
      await load();
    });
  }
  function remove() {
    if (!window.confirm(`Remove ${workerName(modal.worker_id)} from this shift?`)) return;
    run(async () => {
      await request(endpoint, { action: "delete", payload: { id: modal.id } });
      setModal(null);
      setNotice("Scheduled shift removed.");
      await load();
    });
  }

  const set = (k, v) => setModal((m) => ({ ...m, [k]: v }));
  const activeWorkers = workers.filter((w) => w.active);
  const overnight = modal && modal.start && modal.end && modal.end <= modal.start;
  const selectedEntries = selected ? byDay.get(selected) || [] : [];
  const todayKey = dayKey(today);

  return (
    <div className="sch">
      {error && (
        <div className="notice tc-error" role="alert">
          {error}
          <button onClick={() => run(load)} disabled={busy}>Refresh</button>
        </div>
      )}
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="between sch-head">
        <div>
          <h2>Schedule</h2>
          <p className="sub">Click a day to view · double-click to add a shift</p>
        </div>
        <button className="primary" onClick={() => openCreate(selected ? fromKey(selected) : today)}>
          + Add shift
        </button>
      </div>
      <div className="sch-layout">
        <div className="sch-frame">
          {!entries ? (
            <div className="empty" role="status">Loading schedule…</div>
          ) : (
            segments.map((seg) => (
              <section key={`${seg.year}-${seg.month}`} className="sch-month">
                <div className="sch-monthhead">
                  <h3>{MONTHS[seg.month]}</h3>
                  <span>{seg.year}</span>
                </div>
                <div className="sch-grid sch-days" aria-hidden="true">
                  {DAYS.map((d) => <div key={d}>{d}</div>)}
                </div>
                <div className="sch-grid sch-cells">
                  {seg.cells.map((d) => {
                    const k = dayKey(d);
                    const inMonth = d.getMonth() === seg.month;
                    const past = k < todayKey;
                    const list = inMonth ? byDay.get(k) || [] : [];
                    return (
                      <div
                        key={k}
                        role={inMonth ? "button" : undefined}
                        tabIndex={inMonth ? 0 : -1}
                        aria-label={inMonth ? `${d.toDateString()}, ${list.length} scheduled` : undefined}
                        className={`sch-cell${inMonth ? "" : " outside"}${past ? " past" : ""}${selected === k && inMonth ? " selected" : ""}`}
                        onClick={() => inMonth && setSelected(k)}
                        onDoubleClick={() => inMonth && openCreate(d)}
                        onKeyDown={(e) => {
                          if (!inMonth) return;
                          if (e.key === "Enter") setSelected(k);
                        }}
                      >
                        <span className={`sch-num${k === todayKey && inMonth ? " today" : ""}`}>
                          {inMonth ? d.getDate() : ""}
                        </span>
                        {list.slice(0, 3).map((e) => (
                          <button
                            type="button"
                            key={e.id}
                            className="sch-chip"
                            style={{ "--chip": roleColor(e.role_id) }}
                            title={`${workerName(e.worker_id)} · ${roleName(e.role_id)} · ${time(e.starts_at)}–${time(e.ends_at)}`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setSelected(k);
                              openEdit(e);
                            }}
                            onDoubleClick={(ev) => ev.stopPropagation()}
                          >
                            <span className="sch-chipname">{workerName(e.worker_id)}</span>
                            <span className="sch-chiptime">
                              {shortTime(e.starts_at)}–{shortTime(e.ends_at)} · {roleName(e.role_id)}
                            </span>
                          </button>
                        ))}
                        {list.length > 3 && <span className="sch-more">+{list.length - 3} more</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
        {selected && (
          <aside className="panel sch-detail">
            <h3>
              {fromKey(selected).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </h3>
            {!selectedEntries.length && <p className="sub">No one scheduled this day.</p>}
            {selectedEntries.map((e) => (
              <div key={e.id} className="sch-item" style={{ "--chip": roleColor(e.role_id) }}>
                <div>
                  <b>{workerName(e.worker_id)}</b>
                  <span className="sub">{roleName(e.role_id)}</span>
                  <span className="mono">{time(e.starts_at)} – {time(e.ends_at)}</span>
                  <span className="sub mono">{duration(Date.parse(e.ends_at) - Date.parse(e.starts_at))}</span>
                  {e.note && <span className="sub tc-preserve">{e.note}</span>}
                </div>
                <button onClick={() => openEdit(e)}>Edit</button>
              </div>
            ))}
            <button className="wide" onClick={() => openCreate(fromKey(selected))}>+ Add to this day</button>
          </aside>
        )}
      </div>
      <div className="sch-legend">
        <span className="eyebrow">Roles</span>
        {roles.filter((r) => r.active).map((r) => (
          <span key={r.id}><i style={{ background: roleColor(r.id) }} />{r.name}</span>
        ))}
      </div>
      <section className="panel sch-week">
        <span className="eyebrow">Scheduled this week</span>
        {!weekSummary.length ? (
          <p className="sub">No shifts scheduled this week yet.</p>
        ) : (
          <div className="sch-weeklist">
            {weekSummary.map(([id, hours]) => (
              <span key={id} className="pill">
                {workerName(id)} <b className="mono">{hours.toFixed(1)}h</b>
              </span>
            ))}
          </div>
        )}
      </section>

      {modal && (
        <div className="tc-confirm" role="dialog" aria-modal="true" aria-label={modal.mode === "create" ? "Add shift" : "Edit shift"}
          onKeyDown={(e) => e.key === "Escape" && !busy && setModal(null)}>
          <form className="panel tc-form sch-form" onSubmit={save}>
            <h2>{modal.mode === "create" ? "Add shift" : "Edit shift"}</h2>
            <div className="sch-times">
              <label>
                Date
                <input type="date" required value={modal.day} onChange={(e) => set("day", e.target.value)} />
              </label>
              <label>
                Start
                <input type="time" required step="900" value={modal.start} onChange={(e) => set("start", e.target.value)} />
              </label>
              <label>
                End
                <input type="time" required step="900" value={modal.end} onChange={(e) => set("end", e.target.value)} />
              </label>
            </div>
            {overnight && <p className="sub">Ends the next day.</p>}
            {modal.mode === "create" ? (
              <fieldset className="sch-people">
                <legend>People and roles</legend>
                {!activeWorkers.length && <p className="sub">Add staff profiles first.</p>}
                {activeWorkers.map((w) => {
                  const options = assignedRoles(w.id);
                  const checked = Object.hasOwn(modal.people, w.id);
                  return (
                    <div key={w.id} className="sch-person">
                      <label className="task">
                        <input
                          type="checkbox"
                          disabled={!options.length}
                          checked={checked}
                          onChange={(e) => {
                            const people = { ...modal.people };
                            if (e.target.checked) people[w.id] = options[0].id;
                            else delete people[w.id];
                            set("people", people);
                          }}
                        />
                        <span>{w.name}{!options.length && " (no roles assigned)"}</span>
                      </label>
                      {checked && (
                        <select
                          aria-label={`${w.name} role`}
                          value={modal.people[w.id]}
                          onChange={(e) => set("people", { ...modal.people, [w.id]: e.target.value })}
                        >
                          {options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            ) : (
              <div className="sch-times">
                <label>
                  Person
                  <select
                    value={modal.worker_id}
                    onChange={(e) => {
                      const options = assignedRoles(e.target.value);
                      setModal((m) => ({
                        ...m,
                        worker_id: e.target.value,
                        role_id: options.some((r) => r.id === m.role_id) ? m.role_id : options[0]?.id || "",
                      }));
                    }}
                  >
                    {workers.filter((w) => w.active || w.id === modal.worker_id).map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Role
                  <select value={modal.role_id} onChange={(e) => set("role_id", e.target.value)}>
                    {assignedRoles(modal.worker_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
              </div>
            )}
            <label>
              Note (optional)
              <textarea maxLength={500} value={modal.note} onChange={(e) => set("note", e.target.value)} placeholder="Event, call time, instructions" />
            </label>
            <div className="row wrap">
              <button className="primary" disabled={busy}>
                {modal.mode === "create" ? "Save shift" : "Save changes"}
              </button>
              <button type="button" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
              {modal.mode === "edit" && (
                <button type="button" className="sch-danger" disabled={busy} onClick={remove}>Remove</button>
              )}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
