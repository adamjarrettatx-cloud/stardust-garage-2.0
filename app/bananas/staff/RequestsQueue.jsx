"use client";

import { useCallback, useEffect, useState } from "react";
import { request, time } from "@/app/components/time-clock/Shared";
import { chicagoInput, chicagoToIso, duration } from "@/lib/time-clock/core.mjs";

const endpoint = "/api/admin/time-clock/requests";
const KIND = { edit_shift: "Hours fix", missed_shift: "Missed shift", time_off: "Time off" };
const STATUS = { pending: "Waiting", approved: "Approved", denied: "Declined", cancelled: "Cancelled" };
const day = (iso) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
const span = (a, b) => `${time(a)} – ${time(b)}`;
const local = (iso) => chicagoInput(iso).slice(0, 16);
function austinIso(value) {
  try {
    return chicagoToIso(value);
  } catch (e) {
    if (/occurs twice/.test(e.message)) return chicagoToIso(value, "-05:00");
    throw e;
  }
}

// Manager approval queue for employee hour fixes, missed shifts and time off.
export default function RequestsQueue({ onCount }) {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(null); // { id, mode: 'approve'|'adjust'|'deny'|'revoke', note, start, end }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const r = await request(`${endpoint}?status=${filter}`);
      setRows(r.requests);
      onCount?.(r.pending_count);
    } catch (e) {
      setError(e.message);
    }
  }, [filter, onCount]);
  useEffect(() => {
    load();
  }, [load]);

  async function decide(r) {
    setBusy(true);
    setError("");
    try {
      const payload = {
        action: open.mode === "deny" ? "deny" : open.mode === "revoke" ? "revoke_time_off" : "approve",
        id: r.id,
        version: r.version,
        note: open.note || "",
      };
      if (open.mode === "adjust") {
        payload.starts_at = austinIso(open.start);
        payload.ends_at = austinIso(open.end);
      }
      const result = await request(endpoint, payload);
      const conflicts = result.schedule_conflicts || [];
      setNotice(
        payload.action === "approve"
          ? conflicts.length
            ? `Approved. ${r.worker_name} is still scheduled ${conflicts.map((c) => `${day(c.starts_at)} ${span(c.starts_at, c.ends_at)}`).join(", ")} — update the Schedule tab.`
            : r.kind === "time_off"
              ? "Time off approved. It now blocks scheduling for those days."
              : "Approved. The timesheet is updated and the shift is marked approved."
          : payload.action === "deny"
            ? "Declined. The employee sees your note."
            : "Time off revoked.",
      );
      setOpen(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const filters = [
    ["pending", "Waiting"],
    ["time_off", "Upcoming time off"],
    ["all", "All recent"],
  ];
  return (
    <section>
      <div className="filterbar">
        {filters.map(([id, label]) => (
          <button key={id} className={filter === id ? "primary" : ""} onClick={() => { setFilter(id); setOpen(null); }}>
            {label}
          </button>
        ))}
      </div>
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="notice tc-error" role="alert">{error}</div>}
      {!rows ? (
        <div className="empty" role="status">Loading requests…</div>
      ) : !rows.length ? (
        <div className="panel empty">{filter === "pending" ? "No requests waiting. You’re caught up." : "Nothing here yet."}</div>
      ) : (
        <div className="rq-list">
          {rows.map((r) => {
            const start = r.applied_start || r.requested_start, end = r.applied_end || r.requested_end;
            const isOpen = open?.id === r.id;
            return (
              <article key={r.id} className="panel rq-card">
                <div className="between wrap">
                  <div>
                    <b>{r.worker_name}</b> · {KIND[r.kind]}
                    <span className="cellsub">Sent {day(r.created_at)}</span>
                  </div>
                  <span className={`pill${r.status === "pending" ? " warning" : ""}`}>{STATUS[r.status]}</span>
                </div>
                <div className="rq-times mono">
                  {r.kind === "edit_shift" ? (
                    <>
                      <span>{day(r.original_start)} · {r.shift_roles?.join(" / ")}</span>
                      <span>Recorded <s>{span(r.original_start, r.original_end)}</s> ({duration(Date.parse(r.original_end) - Date.parse(r.original_start))})</span>
                      <span>Requested <b>{span(r.requested_start, r.requested_end)}</b> ({duration(Date.parse(r.requested_end) - Date.parse(r.requested_start))})</span>
                    </>
                  ) : r.kind === "missed_shift" ? (
                    <span>{day(start)} · {span(start, end)} · {r.role_name} ({duration(Date.parse(end) - Date.parse(start))})</span>
                  ) : (
                    <span>{day(start)} – {day(new Date(Date.parse(end) - 1).toISOString())}</span>
                  )}
                </div>
                <p className="sub tc-preserve">&ldquo;{r.reason}&rdquo;</p>
                {r.manager_note && <p className="sub tc-preserve">Your note: {r.manager_note}</p>}

                {r.status === "pending" && !isOpen && (
                  <div className="row wrap">
                    <button className="primary" onClick={() => setOpen({ id: r.id, mode: "approve", note: "" })}>Approve</button>
                    {r.kind !== "time_off" && (
                      <button onClick={() => setOpen({ id: r.id, mode: "adjust", note: "", start: local(r.requested_start), end: local(r.requested_end) })}>
                        Approve with changes
                      </button>
                    )}
                    <button onClick={() => setOpen({ id: r.id, mode: "deny", note: "" })}>Decline</button>
                  </div>
                )}
                {r.status === "approved" && r.kind === "time_off" && Date.parse(end) > Date.now() && !isOpen && (
                  <button onClick={() => setOpen({ id: r.id, mode: "revoke", note: "" })}>Revoke time off</button>
                )}
                {isOpen && (
                  <form className="tc-form rq-form" onSubmit={(e) => { e.preventDefault(); decide(r); }}>
                    {open.mode === "adjust" && (
                      <div className="rq-two">
                        <label>Start<input type="datetime-local" required value={open.start} onChange={(e) => setOpen({ ...open, start: e.target.value })} /></label>
                        <label>End<input type="datetime-local" required value={open.end} onChange={(e) => setOpen({ ...open, end: e.target.value })} /></label>
                      </div>
                    )}
                    <label>
                      {open.mode === "deny" || open.mode === "revoke" ? "Note to the employee (required)" : "Note to the employee (optional)"}
                      <textarea maxLength={500} required={open.mode === "deny" || open.mode === "revoke"} value={open.note}
                        onChange={(e) => setOpen({ ...open, note: e.target.value })} />
                    </label>
                    <div className="row wrap">
                      <button className="primary" disabled={busy}>
                        {open.mode === "deny" ? "Decline request" : open.mode === "revoke" ? "Revoke time off" : "Confirm approval"}
                      </button>
                      <button type="button" onClick={() => setOpen(null)}>Cancel</button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
