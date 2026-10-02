"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Frame, request, time, date, money } from "@/app/components/time-clock/Shared";
import { createClient } from "@/lib/supabase/client";
import { duration, elapsedMs, estimateCents } from "@/lib/time-clock/core.mjs";

const weekday = (iso) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
const hours = (ms) => (ms / 3600000).toFixed(2);

export default function EmployeePortal({ enabled }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState("14");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [pw, setPw] = useState(null);
  const [pwMsg, setPwMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await request(`/api/employee/me?days=${days}`));
    } catch (e) {
      if (e.status === 401) window.location.replace("/employee/login");
      else setError(e.message);
    }
  }, [days]);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  async function signOut() {
    await fetch("/api/employee/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.replace("/employee/login");
  }
  async function changePassword(e) {
    e.preventDefault();
    setPwMsg("");
    if (pw.next.length < 10) return setPwMsg("Use at least 10 characters.");
    if (pw.next !== pw.confirm) return setPwMsg("The passwords do not match.");
    const { error: err } = await createClient().auth.updateUser({ password: pw.next });
    if (err) return setPwMsg(err.message || "Could not change the password.");
    setPw(null);
    setPwMsg("Password changed.");
  }

  const view = useMemo(() => {
    if (!data) return null;
    const upcoming = data.schedule.filter((s) => Date.parse(s.ends_at) >= now);
    const open = data.shifts.find((s) => !s.ended_at);
    const closed = data.shifts.filter((s) => s.ended_at);
    const workedMs = data.shifts.reduce((sum, s) => sum + elapsedMs(s, now), 0);
    const pay = closed.map(estimateCents);
    const known = pay.filter((c) => c !== null).reduce((a, b) => a + b, 0);
    const weekAhead = upcoming
      .filter((s) => Date.parse(s.starts_at) < now + 7 * 86400000)
      .reduce((sum, s) => sum + Date.parse(s.ends_at) - Math.max(now, Date.parse(s.starts_at)), 0);
    return { upcoming, open, closed, workedMs, known, missing: pay.filter((c) => c === null).length, weekAhead };
  }, [data, now]);

  return (
    <Frame owner>
      <div className="emp">
        <div className="between ownerhead">
          <div>
            <span className="eyebrow">STARDUST GARAGE / STAFF HUB</span>
            <h1>{data ? data.worker.name : "My schedule"}</h1>
            <p className="sub">Your schedule, hours and pay. Clock in and out on the front-room iPad.</p>
          </div>
          <div className="row">
            <button onClick={() => setPw(pw ? null : { next: "", confirm: "" })}>Change password</button>
            <button onClick={signOut}>Sign out</button>
          </div>
        </div>
        {pwMsg && <div className="notice" role="status">{pwMsg}</div>}
        {pw && (
          <form className="panel tc-form" onSubmit={changePassword}>
            <h2>Change password</h2>
            <label>
              New password
              <input type="password" autoComplete="new-password" minLength={10} maxLength={72} required
                value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </label>
            <label>
              Confirm new password
              <input type="password" autoComplete="new-password" minLength={10} maxLength={72} required
                value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            <div className="row wrap">
              <button className="primary">Save password</button>
              <button type="button" onClick={() => setPw(null)}>Cancel</button>
            </div>
          </form>
        )}
        {!enabled ? (
          <div className="notice">Timekeeping is not enabled yet.</div>
        ) : error ? (
          <div className="notice tc-error" role="alert">
            {error}
            <button onClick={load}>Retry</button>
          </div>
        ) : !view ? (
          <div className="empty" role="status">Loading your schedule…</div>
        ) : (
          <>
            <div className="emp-next">
              <section className="panel">
                <span className="eyebrow">Next shift</span>
                {view.upcoming[0] ? (
                  <>
                    <p className="emp-big">{weekday(view.upcoming[0].starts_at)}</p>
                    <p>
                      {time(view.upcoming[0].starts_at)} – {time(view.upcoming[0].ends_at)} ·{" "}
                      <b>{view.upcoming[0].role_name}</b>
                    </p>
                    {view.upcoming[0].note && <p className="sub tc-preserve">{view.upcoming[0].note}</p>}
                    {view.upcoming[0].crew.length > 0 && (
                      <p className="sub">
                        Working with: {view.upcoming[0].crew.map((c) => `${c.name} (${c.role_name})`).join(", ")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="emp-big">No upcoming shifts</p>
                )}
              </section>
              <section className="panel">
                <span className="eyebrow">Time clock</span>
                {view.open ? (
                  <>
                    <p className="emp-big">
                      <span className="pill live">On the clock</span>
                    </p>
                    <p>
                      Since {time(view.open.started_at)} · {duration(elapsedMs(view.open, now))}
                      {view.open.segments.at(-1) && ` · ${view.open.segments.at(-1).role_name}`}
                    </p>
                  </>
                ) : (
                  <p className="emp-big">Off the clock</p>
                )}
                <p className="sub">Scheduled next 7 days: {hours(view.weekAhead)} h</p>
              </section>
            </div>

            <div className="between wrap">
              <h2>My hours</h2>
              <label className="row sub">
                Period
                <select value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="31">Last 31 days</option>
                  <option value="93">Last 93 days</option>
                </select>
              </label>
            </div>
            <div className="metrics">
              <div className="metric">
                <span className="sub">Hours worked</span>
                <b className="mono">{hours(view.workedMs)}</b>
              </div>
              <div className="metric">
                <span className="sub">Shifts</span>
                <b className="mono">{data.shifts.length}</b>
              </div>
              <div className="metric">
                <span className="sub">Estimated pay</span>
                <b className="mono">{money(view.known)}</b>
              </div>
              <div className="metric">
                <span className="sub">Pay rates</span>
                <div className="emp-rates">
                  {data.worker.pay_basis === "flat" ? (
                    <span className="pill">{money(data.worker.flat_cents)} / shift</span>
                  ) : data.worker.pay_basis === "hourly" ? (
                    data.roles.map((r) => (
                      <span className="pill" key={r.id}>
                        {r.name} · {r.rate_cents === null ? "not set" : `${money(r.rate_cents)}/hr`}
                      </span>
                    ))
                  ) : (
                    <span className="sub">Not set yet</span>
                  )}
                </div>
              </div>
            </div>
            <p className="tablefoot">
              Base pay before tips, taxes and deductions.
              {view.missing > 0 && ` ${view.missing} shift${view.missing === 1 ? "" : "s"} without a rate not included.`}
            </p>

            <section className="emp-section">
              <h2>Upcoming schedule</h2>
              {!view.upcoming.length ? (
                <div className="panel empty">No shifts scheduled yet.</div>
              ) : (
                <div className="panel">
                  <ul className="emp-list">
                    {view.upcoming.map((s) => (
                      <li key={s.id}>
                        <div>
                          <b>{weekday(s.starts_at)}</b>
                          <span className="cellsub">
                            {s.role_name}
                            {s.crew.length > 0 && ` · with ${s.crew.map((c) => c.name).join(", ")}`}
                          </span>
                          {s.note && <span className="cellsub tc-preserve">{s.note}</span>}
                        </div>
                        <span className="mono">
                          {time(s.starts_at)} – {time(s.ends_at)} · {duration(Date.parse(s.ends_at) - Date.parse(s.starts_at))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="emp-section">
              <h2>Worked shifts</h2>
              {!data.shifts.length ? (
                <div className="panel empty">No shifts in this period.</div>
              ) : (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Role</th>
                        <th>Clock in → out</th>
                        <th>Hours</th>
                        <th>Est. pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shifts.map((s) => {
                        const cents = estimateCents(s);
                        return (
                          <tr key={s.id}>
                            <td>{date(s.started_at)}</td>
                            <td>{[...new Set(s.segments.map((g) => g.role_name))].join(" / ")}</td>
                            <td className="mono">
                              {time(s.started_at)} → {s.ended_at ? time(s.ended_at) : "now"}
                            </td>
                            <td className="mono">{hours(elapsedMs(s, now))}</td>
                            <td className="mono">{s.ended_at ? (cents === null ? "—" : money(cents)) : "In progress"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Frame>
  );
}
