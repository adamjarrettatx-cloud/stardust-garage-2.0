"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PIN_LENGTH, PIN_PATTERN } from "@/lib/time-clock/pin.mjs";
import {
  Frame,
  Status,
  request,
  time,
  date,
  money,
} from "@/app/components/time-clock/Shared";
import {
  duration,
  dollarsToCents,
  chicagoInput,
  chicagoToIso,
} from "@/lib/time-clock/core.mjs";

import ScheduleCalendar from "./ScheduleCalendar";
import StaffList from "./StaffList";
import StaffProfile from "./StaffProfile";
import RequestsQueue from "./RequestsQueue";
import TimesheetCalendar from "./TimesheetCalendar";
import { addDays, chicagoYmd, dayStartIso, payPeriodEnd, payPeriodStart } from "@/lib/time-clock/periods.mjs";
import RolesPanel from "./RolesPanel";

const endpoint = "/api/admin/time-clock";
const blankWorker = {
  name: "",
  category: "employee",
  active: true,
  pay_basis: "unset",
  flat: "",
  roles: {},
  pin: "",
};
export default function Staff({ enabled }) {
  const [data, setData] = useState(null),
    [tab, setTab] = useState("schedule"),
    [error, setError] = useState(""),
    [pendingRequests, setPendingRequests] = useState(0),
    [periodStart, setPeriodStart] = useState(() => payPeriodStart(chicagoYmd()));
  const detailRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null),
    [reviewNote, setReviewNote] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [editWorker, setEditWorker] = useState(null),
    [disclosure, setDisclosure] = useState(null);
  const [deviceName, setDeviceName] = useState("Front room iPad"),
    [confirm, setConfirm] = useState(null);
  const [replacementPin, setReplacementPin] = useState("");
  const [correction, setCorrection] = useState(null),
    [notice, setNotice] = useState(""),
    [now, setNow] = useState(Date.now());
  // Waiting-request badge on the Requests tab; refreshed when tabs change.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    request("/api/admin/time-clock/requests?status=pending")
      .then((r) => live && setPendingRequests(r.pending_count))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, tab]);
  const mutex = useRef(false),
    fetchGeneration = useRef(0);
  const dialog = useRef(null);
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement;
    const node = dialog.current;
    node?.querySelector("button")?.focus();
    function trap(e) {
      if (e.key === "Escape" && !mutex.current) setConfirm(null);
      if (e.key !== "Tab") return;
      const items = [
        ...node.querySelectorAll("button:not(:disabled), input:not(:disabled)"),
      ];
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    node?.addEventListener("keydown", trap);
    return () => {
      node?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [confirm]);
  // Page data and CSV export cover the pay period shown on the calendar
  // (Monday through the second Sunday, Austin time).
  const range = useCallback(() => {
    const end = payPeriodEnd(periodStart);
    return new URLSearchParams({
      from: dayStartIso(periodStart),
      // The API includes `to`; stop 1 ms before the next period's midnight.
      to: new Date(Date.parse(dayStartIso(addDays(end, 1))) - 1).toISOString(),
    });
  }, [periodStart]);
  const load = useCallback(async () => {
    const generation = ++fetchGeneration.current;
    const next = await request(`${endpoint}?${range()}`);
    if (generation === fetchGeneration.current) setData(next);
    return next;
  }, [range]);
  useEffect(() => {
    if (!enabled) return;
    load().catch((e) => setError(e.message));
  }, [enabled, load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Only live overview refreshes; never replace open correction/review forms.
  useEffect(() => {
    if (!enabled || tab !== "timesheets" || detail || correction) return;
    const timer = setInterval(() => {
      if (!mutex.current) load().catch((e) => setError(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [enabled, tab, detail, correction, load]);
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
  async function mutate(action, payload, after) {
    await run(async () => {
      const result = await request(endpoint, { action, payload });
      after?.(result);
      await load();
    });
  }
  async function view(id) {
    await run(async () => {
      const r = await request(`${endpoint}?shift=${id}`);
      setDetail(r.shift);
      setReviewNote("");
      setCorrection(null);
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  }
  // The calendar saves its own approvals/corrections; refresh the list view
  // and any open Details panel so no section keeps showing old punches.
  async function calendarChanged() {
    await load().catch((e) => setError(e.message));
    const open = detail?.id;
    if (!open) return;
    try {
      const r = await request(`${endpoint}?shift=${open}`);
      setDetail((d) => (d?.id === open ? r.shift : d));
      setCorrection(null);
    } catch (e) {
      setError(e.message);
    }
  }
  function chooseWorker(w) {
    setEditWorker(
      w
        ? {
            ...w,
            birthdate: w.birthdate || "",
            flat: w.flat_cents === null ? "" : (w.flat_cents / 100).toFixed(2),
            roles: Object.fromEntries(
              data.assignments
                .filter((a) => a.worker_id === w.id)
                .map((a) => [
                  a.role_id,
                  a.rate_cents === null ? "" : (a.rate_cents / 100).toFixed(2),
                ]),
            ),
          }
        : structuredClone(blankWorker),
    );
    setDisclosure(null);
  }
  function saveWorker(e) {
    e.preventDefault();
    run(async () => {
      const payload = {
        id: editWorker.id,
        name: editWorker.name,
        category: editWorker.category,
        active: editWorker.active,
        pay_basis: editWorker.pay_basis,
        flat_cents:
          editWorker.pay_basis === "flat"
            ? dollarsToCents(editWorker.flat)
            : null,
        roles: Object.entries(editWorker.roles).map(([role_id, rate]) => ({
          role_id,
          rate_cents: dollarsToCents(rate),
        })),
        ...(!editWorker.id ? { pin: editWorker.pin } : {}),
        ...(editWorker.birthdate ? { birthdate: editWorker.birthdate } : {}),
      };
      const result = await request(endpoint, {
        action: "save_worker",
        payload,
      });
      setEditWorker(null);
      if (result.id) setProfileId(result.id);
      setNotice(
        "Profile saved. Historical rates are unchanged.",
      );
      if (result.pin)
        setDisclosure({
          title: "New worker PIN",
          value: result.pin,
          text: "Give this PIN privately to the worker. It will not be shown again.",
        });
      await load();
    });
  }
  function saveCorrection(e) {
    e.preventDefault();
    run(async () => {
      const start =
        correction.started_at === chicagoInput(detail.started_at) &&
        !correction.start_offset
          ? detail.started_at
          : chicagoToIso(correction.started_at, correction.start_offset);
      const end =
        detail.ended_at &&
        correction.ended_at === chicagoInput(detail.ended_at) &&
        !correction.end_offset
          ? detail.ended_at
          : chicagoToIso(correction.ended_at, correction.end_offset);
      const result = await request(endpoint, {
        action: "correct",
        payload: {
          id: detail.id,
          version: detail.version,
          started_at: start,
          ended_at: end,
          reason: correction.reason,
        },
      });
      setDetail(result.shift);
      setCorrection(null);
      setNotice(
        "Correction recorded. Original punches retained; approval reset.",
      );
      await load();
    });
  }
  const exportCsv = () =>
    run(async () => {
      const query = range();
      query.set("format", "csv");
      query.set("status", "all");
      const response = await fetch(`${endpoint}?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "Export failed.");
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "sdg-staff.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const field = (key, value) => setEditWorker((w) => ({ ...w, [key]: value }));
  return (
    <Frame owner>
      <div className="between ownerhead">
        <h1>Team time & shifts</h1>
        <div className="row tc-headicons">
          <span className="tc-tip" data-tip="Devices">
            <button
              type="button"
              className={`tc-iconbtn${tab === "devices" ? " active" : ""}`}
              aria-label="Devices"
              aria-pressed={tab === "devices"}
              disabled={!enabled}
              onClick={() => {
                setTab("devices");
                setDetail(null);
                setCorrection(null);
                setDisclosure(null);
                setEditWorker(null);
                setProfileId(null);
              }}
            >
              {/* Monitor + phone: paired kiosk devices */}
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
                <path d="M10 19v-4" />
                <path d="M7 19h5" />
                <rect x="16" y="12" width="6" height="10" rx="2" />
              </svg>
            </button>
          </span>
          <span className="tc-tip" data-tip="Open kiosk">
            <a
              className="tc-linkbutton tc-iconbtn"
              href="/clock"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open kiosk in a new tab"
            >
              {/* Tablet: the paired iPad time clock */}
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <line x1="11" y1="18" x2="13" y2="18" />
              </svg>
            </a>
          </span>
          <span className="tc-tip" data-tip="Export CSV">
            <button
              className="primary tc-iconbtn"
              disabled={!data || busy}
              onClick={exportCsv}
              aria-label="Export CSV"
            >
              {/* Download into tray: export the timesheet file */}
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </span>
        </div>
      </div>
      {!enabled ? (
        <div className="notice">
          <h2>Staff setup pending</h2>
          <p>
            The migration and server configuration must be approved and
            installed before this can record work. No staff data has been
            loaded.
          </p>
        </div>
      ) : (
        <>
          {error && (
            <div className="notice tc-error" role="alert">
              {error}
              <button onClick={() => run(load)} disabled={busy}>
                Refresh
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {disclosure && (
            <section className="panel tc-disclosure">
              <h2>{disclosure.title}</h2>
              <p className="shiftstat mono">{disclosure.value}</p>
              <p>{disclosure.text}</p>
              <button onClick={() => setDisclosure(null)}>
                I&apos;ve saved it · hide
              </button>
            </section>
          )}
          <nav className="tabs" aria-label="Staff sections">
            {["schedule", "timesheets", "requests", "people", "roles"].map((t) => (
              <button
                key={t}
                type="button"
                className={t === tab ? "active" : ""}
                aria-current={t === tab ? "page" : undefined}
                onClick={() => {
                  setTab(t);
                  setDetail(null);
                  setCorrection(null);
                  setDisclosure(null);
                  setEditWorker(null);
                  setProfileId(null);
                }}
              >
                {t === "schedule"
                  ? "Schedule"
                  : t === "timesheets"
                  ? "Timesheets"
                  : t === "requests"
                  ? pendingRequests ? `Requests (${pendingRequests})` : "Requests"
                  : t === "people"
                    ? "Staff profiles"
                    : "Roles & duties"}
              </button>
            ))}
          </nav>
          {!data ? (
            <div className="empty" role="status">
              Loading staff…
            </div>
          ) : (
            <>
              {tab === "schedule" && (
                <ScheduleCalendar
                  workers={data.workers}
                  roles={data.roles}
                  assignments={data.assignments}
                />
              )}
              {tab === "requests" && <RequestsQueue onCount={setPendingRequests} />}
              {tab === "timesheets" && (
                <>
                  {data.open.some(
                    (s) => now - Date.parse(s.started_at) > 16 * 3600000,
                  ) && (
                    <div className="notice">
                      <h2>Long-running shifts need attention</h2>
                      <p>
                        These may be missed clock-outs. No hours are deducted
                        automatically.
                      </p>
                      {data.open
                        .filter(
                          (s) => now - Date.parse(s.started_at) > 16 * 3600000,
                        )
                        .map((s) => (
                          <button key={s.id} onClick={() => view(s.id)}>
                            {data.workers.find((w) => w.id === s.worker_id)
                              ?.name || "Worker"}{" "}
                            · {date(s.started_at)}
                          </button>
                        ))}
                    </div>
                  )}
                  <TimesheetCalendar
                    workers={data.workers}
                    refreshKey={data}
                    onOpenDetail={view}
                    onChanged={calendarChanged}
                    onPeriodChange={setPeriodStart}
                  />
                  {detail && (
                    <section className="panel details" ref={detailRef}>
                      <div className="between">
                        <div>
                          <span className="eyebrow">SHIFT DETAIL</span>
                          <h2>
                            {detail.worker_name} · {date(detail.started_at)}
                          </h2>
                          <Status shift={detail} />
                        </div>
                        <button
                          onClick={() => {
                            setDetail(null);
                            setCorrection(null);
                          }}
                        >
                          Close
                        </button>
                      </div>
                      <div className="detailsgrid">
                        <div>
                          <h2>Role segments</h2>
                          {detail.segments.map((g) => (
                            <div key={g.id} className="between task">
                              <span>
                                {g.role_name}
                                <span className="cellsub">
                                  {time(g.started_at)} →{" "}
                                  {g.ended_at ? time(g.ended_at) : "Open"}
                                </span>
                              </span>
                              <span>
                                {detail.pay_basis === "flat"
                                  ? "Included in flat fee"
                                  : g.rate_cents === null
                                    ? "Rate not set"
                                    : `${money(g.rate_cents)}/hr`}
                              </span>
                            </div>
                          ))}
                          {detail.pay_basis === "flat" && (
                            <p>Flat shift fee: {money(detail.flat_cents)}</p>
                          )}
                          <h2>Responsibilities</h2>
                          {detail.tasks.map((t) => (
                            <div className="task" key={t.id}>
                              <span>{t.done ? "✓" : "○"}</span>
                              <span>{t.title}</span>
                            </div>
                          ))}
                          <h2>Shift handoff</h2>
                          <p className="sub tc-preserve">
                            {detail.note || "No note added."}
                          </p>
                        </div>
                        <div>
                          <h2>Activity log</h2>
                          <ul className="audit">
                            {detail.audit.map((a) => (
                              <li key={a.id}>
                                <time>
                                  {date(a.at)} · {time(a.at)}
                                </time>
                                {a.action.replaceAll("_", " ")}
                                {a.details?.reason && (
                                  <p className="sub">{a.details.reason}</p>
                                )}
                                {a.action === "correct" && (
                                  <p className="sub">
                                    Before: {date(a.details.before.started_at)}{" "}
                                    {time(a.details.before.started_at)} →{" "}
                                    {a.details.before.ended_at
                                      ? `${date(a.details.before.ended_at)} ${time(a.details.before.ended_at)}`
                                      : "Open"}
                                    <br />
                                    After: {date(
                                      a.details.after.started_at,
                                    )}{" "}
                                    {time(a.details.after.started_at)} →{" "}
                                    {date(a.details.after.ended_at)}{" "}
                                    {time(a.details.after.ended_at)}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                          {detail.ended_at && detail.status !== "approved" && (
                            <>
                              <label className="note" htmlFor="tc-review">
                                Review note (optional)
                              </label>
                              <textarea
                                id="tc-review"
                                maxLength={2000}
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                              />
                              <button
                                className="primary wide"
                                disabled={busy}
                                onClick={() =>
                                  mutate(
                                    "approve",
                                    {
                                      id: detail.id,
                                      version: detail.version,
                                      reason: reviewNote,
                                    },
                                    (r) => {
                                      setDetail(r.shift);
                                      setNotice(
                                        "Timesheet approved. No payment sent.",
                                      );
                                    },
                                  )
                                }
                              >
                                Approve timesheet
                              </button>
                            </>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              setCorrection({
                                started_at: chicagoInput(detail.started_at),
                                ended_at: chicagoInput(
                                  detail.ended_at || Date.now(),
                                ),
                                start_offset: "",
                                end_offset: "",
                                reason: "",
                              })
                            }
                          >
                            Correct shift times
                          </button>
                        </div>
                      </div>
                      {correction && (
                        <form
                          className="panel tc-form"
                          onSubmit={saveCorrection}
                        >
                          <h2>Audited time correction</h2>
                          <p className="sub">
                            Enter Austin time (America/Chicago). Role changes
                            and breaks must remain inside the shift. A repeated
                            hour during the fall time change requires a CDT/CST
                            choice.
                          </p>
                          <label>
                            Start time (Austin)
                            <input
                              required
                              type="datetime-local"
                              step="1"
                              value={correction.started_at}
                              onChange={(e) =>
                                setCorrection((c) => ({
                                  ...c,
                                  started_at: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            End time (Austin)
                            <input
                              required
                              type="datetime-local"
                              step="1"
                              value={correction.ended_at}
                              onChange={(e) =>
                                setCorrection((c) => ({
                                  ...c,
                                  ended_at: e.target.value,
                                }))
                              }
                            />
                          </label>
                          {["start", "end"].map((part) => (
                            <label key={part}>
                              {part === "start" ? "Start" : "End"}{" "}
                              daylight-saving offset
                              <select
                                value={correction[`${part}_offset`]}
                                onChange={(e) =>
                                  setCorrection((c) => ({
                                    ...c,
                                    [`${part}_offset`]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">
                                  Automatic (usual choice)
                                </option>
                                <option value="-05:00">
                                  CDT / UTC−5 (first repeated hour)
                                </option>
                                <option value="-06:00">
                                  CST / UTC−6 (second repeated hour)
                                </option>
                              </select>
                            </label>
                          ))}
                          <label>
                            Required reason
                            <textarea
                              required
                              minLength={5}
                              maxLength={2000}
                              value={correction.reason}
                              onChange={(e) =>
                                setCorrection((c) => ({
                                  ...c,
                                  reason: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <p className="sub">
                            This changes reviewed time, preserves original
                            punches, and reopens approval.
                          </p>
                          <button className="primary" disabled={busy}>
                            Save correction
                          </button>
                          <button
                            type="button"
                            onClick={() => setCorrection(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      )}
                    </section>
                  )}
                </>
              )}
              {tab === "people" && (
                <>
                  <div className="between">
                    <h2>Staff profiles</h2>
                    <button
                      className="primary"
                      onClick={() => {
                        setProfileId(null);
                        chooseWorker(null);
                      }}
                    >
                      Add staff profile
                    </button>
                  </div>
                  <p className="sub sl-note">
                    Adam and Jeyu manage profiles, roles, pay and PINs here. A
                    time-clock profile does not grant access to other SDG tools.
                    PINs are four digits — reset any six-digit PIN before the
                    next clock-in.
                  </p>
                  {editWorker && (
                    <form id="staff-edit-form" className="panel tc-form sp-edit" onSubmit={saveWorker}>
                      <div className="sp-edithead">
                        <h2>{editWorker.id ? "Edit profile" : "New staff profile"}</h2>
                        <span className="tc-tip" data-tip="Close">
                          <button type="button" className="tc-iconbtn" aria-label="Close without saving" onClick={() => setEditWorker(null)}>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        </span>
                      </div>
                      {editWorker.id && (
                        <div className="sp-lock">
                          <div className="sp-photo sm">
                            {editWorker.photo_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={editWorker.photo_url} alt={`${editWorker.name} photo`} />
                            ) : (
                              <span aria-hidden="true">—</span>
                            )}
                          </div>
                          <p className="sub">
                            {editWorker.photo_url
                              ? "Photo is added by the employee from their invite or the staff portal."
                              : "No photo yet. The employee adds it from their invite or the staff portal."}
                          </p>
                        </div>
                      )}
                      <label>
                        Name
                        <input
                          required
                          maxLength={120}
                          value={editWorker.name}
                          onChange={(e) => field("name", e.target.value)}
                        />
                      </label>
                      <div className="sp-two">
                        <label>
                          Status
                          <select
                            value={editWorker.category}
                            onChange={(e) => field("category", e.target.value)}
                          >
                            <option value="employee">Employee</option>
                            <option value="contractor">Contractor</option>
                          </select>
                        </label>
                        <label>
                          Birthday
                          <input
                            type="date"
                            value={editWorker.birthdate || ""}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => field("birthdate", e.target.value)}
                          />
                        </label>
                      </div>
                      <p className="sub">
                        Use your established classification; this setting does
                        not determine legal status.
                      </p>
                      {!editWorker.id && (
                        <label>
                          PIN (optional)
                          <input
                            type="password"
                            inputMode="numeric"
                            autoComplete="new-password"
                            pattern={PIN_PATTERN}
                            maxLength={PIN_LENGTH}
                            value={editWorker.pin}
                            onChange={(e) => field("pin", e.target.value)}
                            placeholder="Leave blank"
                          />
                          <span className="sub">
                            Leave blank and the employee chooses their own PIN
                            when they accept their email invite. If you set one
                            here, it is displayed once for private delivery.
                          </span>
                        </label>
                      )}
                      <label>
                        Pay basis
                        <select
                          value={editWorker.pay_basis}
                          onChange={(e) => field("pay_basis", e.target.value)}
                        >
                          <option value="hourly">Hourly by role</option>
                          <option value="flat">Flat shift fee</option>
                          <option value="unset">Not configured</option>
                        </select>
                      </label>
                      {editWorker.pay_basis === "flat" && (
                        <label>
                          Flat fee ($)
                          <input
                            inputMode="decimal"
                            required
                            value={editWorker.flat}
                            onChange={(e) => field("flat", e.target.value)}
                          />
                        </label>
                      )}
                      <div className="sp-label">
                        {editWorker.pay_basis === "hourly" ? "Roles and hourly rate" : "Roles"}
                      </div>
                      <div className="sp-roles">
                        {data.roles.map((r) => {
                          const on = Object.hasOwn(editWorker.roles, r.id);
                          return (
                            <div key={r.id} className={`sp-rr${on ? " on" : ""}`}>
                              <label className="sp-rrname">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) => {
                                    const roles = { ...editWorker.roles };
                                    if (e.target.checked) roles[r.id] = "";
                                    else delete roles[r.id];
                                    field("roles", roles);
                                  }}
                                />
                                <span>
                                  {r.name}
                                  {!r.active && " (inactive)"}
                                </span>
                              </label>
                              {editWorker.pay_basis === "hourly" &&
                                (on ? (
                                  <input
                                    className="sp-rate"
                                    inputMode="decimal"
                                    aria-label={`${r.name} hourly rate in dollars`}
                                    placeholder="$/hr"
                                    value={editWorker.roles[r.id]}
                                    onChange={(e) =>
                                      field("roles", {
                                        ...editWorker.roles,
                                        [r.id]: e.target.value,
                                      })
                                    }
                                  />
                                ) : (
                                  <span className="sub sp-rateoff">—</span>
                                ))}
                            </div>
                          );
                        })}
                      </div>
                      {editWorker.id && (
                        <label className="task">
                          <input
                            type="checkbox"
                            checked={editWorker.active}
                            onChange={(e) => field("active", e.target.checked)}
                          />
                          <span>
                            Active <span className="sub">· turning this off blocks the iPad PIN right away. Open shifts stay for correction.</span>
                          </span>
                        </label>
                      )}
                      <div className="row sp-buttons">
                        <button className="primary" disabled={busy}>
                          Save
                        </button>
                        <button type="button" onClick={() => setEditWorker(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  {!editWorker && profileId && data.workers.some((w) => w.id === profileId) && (
                    <StaffProfile
                      worker={data.workers.find((w) => w.id === profileId)}
                      data={data}
                      onEdit={() => chooseWorker(data.workers.find((w) => w.id === profileId))}
                      onClose={() => setProfileId(null)}
                    />
                  )}
                  <StaffList
                    data={data}
                    busy={busy}
                    run={run}
                    onOpen={(w) => {
                      setEditWorker(null);
                      setProfileId(w.id);
                    }}
                    onEdit={(w) => {
                      setProfileId(w.id);
                      chooseWorker(w);
                      requestAnimationFrame(() =>
                        document
                          .getElementById("staff-edit-form")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                      );
                    }}
                    onResetPin={(w) => {
                      setReplacementPin("");
                      setError("");
                      setConfirm({
                        action: "reset_pin",
                        id: w.id,
                        label: w.has_pin
                          ? `Set a new PIN for ${w.name}? The old PIN and current PIN session will stop working.`
                          : `Set a PIN for ${w.name}?`,
                      });
                    }}
                    onDone={async ({ notice: text, disclosure: shown }) => {
                      if (text) setNotice(text);
                      if (shown) setDisclosure(shown);
                      await load();
                    }}
                  />
                  {!data.workers.length && (
                    <div className="empty">
                      Add your first worker, assign roles, then invite them by
                      email to choose their own PIN.
                    </div>
                  )}
                </>
              )}
              {tab === "roles" && (
                <RolesPanel
                  data={data}
                  busy={busy}
                  onError={setError}
                  onSave={(role, done) => mutate("save_role", role, done)}
                />
              )}
              {tab === "devices" && (
                <>
                  <h2>Paired kiosks</h2>
                  <p className="sub">
                    Create a code here, then open /clock directly on the shared
                    iPad. Codes expire after 15 minutes and can be used once.
                    Device access expires after 90 days.
                  </p>
                  <form
                    className="panel tc-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      mutate("create_kiosk", { label: deviceName }, (r) =>
                        setDisclosure({
                          title: "One-time pairing code",
                          value: r.pairing_code,
                          text: "Enter this code on the iPad at /clock within 15 minutes. Do not share it outside your team.",
                        }),
                      );
                    }}
                  >
                    <label>
                      Device name
                      <input
                        required
                        maxLength={80}
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value)}
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Create pairing code
                    </button>
                  </form>
                  <div className="staffgrid">
                    {data.kiosks.map((k) => (
                      <section className="panel" key={k.id}>
                        <h2>{k.label}</h2>
                        <p className="sub">
                          {k.revoked_at
                            ? "Revoked"
                            : k.expires_at
                              ? Date.parse(k.expires_at) > now
                                ? `Paired · expires ${date(k.expires_at)}`
                                : "Expired · create a new pairing"
                              : Date.parse(k.pairing_expires) > now
                                ? "Awaiting pairing"
                                : "Pairing code expired"}
                        </p>
                        {!k.revoked_at && (
                          <button
                            onClick={() =>
                              setConfirm({
                                action: "revoke_kiosk",
                                id: k.id,
                                label: `Revoke ${k.label}? The device will stop accepting all PIN sessions and punches. Open shifts are preserved.`,
                              })
                            }
                          >
                            Revoke device
                          </button>
                        )}
                      </section>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {confirm && (
            <section
              className="tc-confirm"
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-label="Confirm access change"
            >
              <form
                className="panel tc-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  mutate(
                    confirm.action,
                    {
                      id: confirm.id,
                      ...(confirm.action === "reset_pin"
                        ? { pin: replacementPin }
                        : {}),
                    },
                    (r) => {
                      setConfirm(null);
                      setReplacementPin("");
                      if (r.pin)
                        setDisclosure({
                          title: "Replacement PIN",
                          value: r.pin,
                          text: "Give this privately to the worker. The old PIN no longer works.",
                        });
                      else setNotice("Device access revoked.");
                    },
                  );
                }}
              >
                <h2>Confirm access change</h2>
                <p>{confirm.label}</p>
                {confirm.action === "reset_pin" && (
                  <label>
                    New PIN (optional)
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      pattern={PIN_PATTERN}
                      maxLength={PIN_LENGTH}
                      value={replacementPin}
                      onChange={(e) => setReplacementPin(e.target.value)}
                      placeholder="Leave blank to generate"
                      disabled={busy}
                    />
                    <span className="sub">
                      Choose four digits or leave blank to generate a
                      replacement. Current PINs cannot be viewed.
                    </span>
                  </label>
                )}
                {error && <p role="alert">{error}</p>}
                <button className="primary" disabled={busy}>
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </Frame>
  );
}
