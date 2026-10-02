"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Frame,
  ShiftTable,
  Status,
  request,
  time,
  date,
} from "@/app/components/time-clock/Shared";
import { duration, elapsedMs } from "@/lib/time-clock/core.mjs";
import { PIN_LENGTH } from "@/lib/time-clock/pin.mjs";

const api = (action, body) => request(`/api/time-clock/${action}`, body);
const AUTO_RETURN_SECONDS = 10;
export default function Kiosk({ enabled }) {
  const [data, setData] = useState(null),
    [screen, setScreen] = useState("pin");
  const [pin, setPin] = useState(""),
    [pairCode, setPairCode] = useState(""),
    [role, setRole] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const [pending, setPending] = useState(null),
    [receipt, setReceipt] = useState(null);
  const [now, setNow] = useState(Date.now()),
    [online, setOnline] = useState(true);
  const mutex = useRef(false),
    offset = useRef(0),
    lastActivity = useRef(Date.now()),
    lastTouch = useRef(0),
    expires = useRef(0);
  const activeSession = useRef(false),
    requestGeneration = useRef(0);
  function accept(next) {
    if (next.server_now)
      offset.current = Date.parse(next.server_now) - Date.now();
    expires.current = next.expires_at ? Date.parse(next.expires_at) : 0;
    activeSession.current = Boolean(next.authenticated);
    setData(next);
  }
  async function refresh() {
    const next = await api("state");
    accept(next);
    setNote(next.shift?.note || "");
    return next;
  }
  const lock = useCallback(async () => {
    requestGeneration.current++;
    activeSession.current = false;
    expires.current = 0;
    setData((d) => (d ? { kiosk: d.kiosk, authenticated: false } : null));
    setPin("");
    setRole("");
    setNote("");
    setReceipt(null);
    setPending(null);
    setScreen("pin");
    setError("");
    try {
      await api("lock", {});
    } catch {
      /* UI cleared; server expiry is independent. */
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    api("state")
      .then((next) => {
        if (gone) return;
        accept(next);
        setNote(next.shift?.note || "");
        setScreen(
          next.authenticated ? (next.shift ? "shift" : "roles") : "pin",
        );
      })
      .catch((e) => {
        if (!gone) {
          setError(e.message);
          if (e.code === "device_not_authorized") setScreen("pair");
        }
      });
    return () => {
      gone = true;
    };
  }, [enabled]);
  useEffect(() => {
    const handleNetwork = () => setOnline(navigator.onLine);
    handleNetwork();
    window.addEventListener("online", handleNetwork);
    window.addEventListener("offline", handleNetwork);
    const activity = () => {
      lastActivity.current = Date.now();
      // Heartbeats occur ONLY after actual interaction, never from polling.
      if (
        activeSession.current &&
        Date.now() - lastTouch.current > 25000 &&
        !mutex.current
      ) {
        lastTouch.current = Date.now();
        const generation = requestGeneration.current;
        api("touch", {})
          .then((next) => {
            if (generation !== requestGeneration.current) return;
            if (!next.authenticated) lock();
            else expires.current = Date.parse(next.expires_at);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    const timer = setInterval(() => {
      const serverNow = Date.now() + offset.current;
      setNow(serverNow);
      if (
        activeSession.current &&
        !mutex.current &&
        (Date.now() - lastActivity.current >= 90000 ||
          (expires.current && serverNow >= expires.current))
      )
        lock();
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", handleNetwork);
      window.removeEventListener("offline", handleNetwork);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [lock]);
  // After a clock-in or clock-out confirmation, return to the PIN pad on its
  // own so the next person can clock in even if "Done" is not tapped.
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (screen !== "clockedin" && screen !== "success") return;
    setCountdown(AUTO_RETURN_SECONDS);
    const started = Date.now();
    const timer = setInterval(() => {
      const left = AUTO_RETURN_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        lock();
      } else setCountdown(left);
    }, 250);
    return () => clearInterval(timer);
  }, [screen, lock]);
  async function run(fn) {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      if (e.code === "not_authorized") {
        await lock();
        setError(e.message);
      }
      if (e.code === "device_not_authorized") {
        await lock();
        setScreen("pair");
        setError(e.message);
      }
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  async function identify() {
    await run(async () => {
      const value = pin;
      setPin("");
      await api("pin", { pin: value });
      const next = await refresh();
      lastActivity.current = Date.now();
      lastTouch.current = Date.now();
      setScreen(next.shift ? "shift" : "roles");
      setRole("");
    });
  }
  useEffect(() => {
    if (screen !== "pin" || busy) return;
    const key = (e) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        /INPUT|TEXTAREA/.test(e.target.tagName)
      )
        return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        setPin((p) => (p + e.key).slice(0, PIN_LENGTH));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [screen, busy]);
  async function operate(action, payload, retry = null) {
    const operation = retry || {
      request_id: crypto.randomUUID(),
      action,
      payload,
    };
    await run(async () => {
      setPending(operation);
      let result;
      try {
        result = await api("operation", operation);
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) setPending(null);
        throw e;
      }
      setPending(null);
      if (operation.action === "clock_out") {
        setReceipt(result.shift);
        setScreen("success");
        setData((d) => ({ ...d, shift: null }));
      } else {
        const draft = note,
          dirty = note !== data?.shift?.note;
        const next = await refresh();
        if (dirty && !["note", "clock_in"].includes(operation.action))
          setNote(draft);
        setScreen(
          operation.action === "clock_in" && next.shift
            ? "clockedin"
            : next.shift
              ? "shift"
              : "roles",
        );
      }
    });
  }
  const shift = data?.shift,
    worker = data?.worker,
    onBreak = shift?.breaks?.some((b) => !b.ended_at);
  const disabled = busy || Boolean(pending) || !online;
  async function done() {
    if (shift && note !== shift.note && !disabled) {
      try {
        await api("operation", {
          request_id: crypto.randomUUID(),
          action: "note",
          payload: { shift_id: shift.id, note },
        });
      } catch {
        /* The note stays unsaved; the shift itself is already recorded. */
      }
    }
    lock();
  }
  const header = worker && (
    <div className="between workhead">
      <div className="identity">
        <h1>{worker.name}</h1>
        <span className="sub">Staff time clock</span>
      </div>
      <button type="button" className="donebtn" disabled={busy} onClick={done}>
        Done · next person
      </button>
    </div>
  );
  let content;
  if (!enabled)
    content = (
      <section className="helpbox panel">
        <h1>Time clock is not enabled yet.</h1>
        <p>
          Setup is pending owner approval. Do not use this screen to record work
          until the owner confirms it is live.
        </p>
      </section>
    );
  else if (screen === "pair")
    content = (
      <section className="helpbox panel">
        <span className="eyebrow">DEVICE SETUP</span>
        <h1>Pair this iPad</h1>
        <p className="muted">
          Adam or Jeyu creates a one-time pairing code in Timekeeping → Devices.
          Do not sign the shared iPad into an owner account.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("pair", { code: pairCode });
              setPairCode("");
              await refresh();
              setScreen("pin");
            });
          }}
        >
          <label htmlFor="pair-code" className="note">
            Eight-digit pairing code
          </label>
          <input
            id="pair-code"
            autoComplete="off"
            inputMode="numeric"
            maxLength={8}
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value.replace(/\D/g, ""))}
          />
          <button
            className="primary wide"
            disabled={busy || pairCode.length !== 8 || !online}
          >
            Pair device
          </button>
        </form>
      </section>
    );
  else if (!data && !error)
    content = (
      <div className="empty" role="status">
        Connecting to time clock…
      </div>
    );
  else if (!data && error)
    content = (
      <section className="helpbox panel">
        <h1>Unable to connect</h1>
        <p>
          No clock-in or clock-out has been confirmed. Check the connection or
          ask the owner.
        </p>
        <button
          onClick={() =>
            run(async () => {
              await refresh();
            })
          }
        >
          Retry connection
        </button>
      </section>
    );
  else if (screen === "help")
    content = (
      <section className="helpbox panel">
        <h1>Need help with your shift?</h1>
        <p>
          Ask Adam or Jeyu if you forgot your PIN, missed a punch, or need a
          time correction. Do not use someone else’s PIN.
        </p>
        <button onClick={() => setScreen("pin")}>Back to PIN</button>
      </section>
    );
  else if (screen === "success")
    content = (
      <section className="successbox">
        <div className="successmark">✓</div>
        <span className="eyebrow">SHIFT RECORDED</span>
        <h1>You&apos;re clocked out.</h1>
        <p className="muted">Your shift is saved and ready for owner review.</p>
        <div className="receipt">
          <div className="between">
            <span>Time on shift</span>
            <strong>{duration(elapsedMs(receipt))}</strong>
          </div>
          <div className="between">
            <span>Clock-out</span>
            <span>{time(receipt.ended_at)}</span>
          </div>
        </div>
        <button className="primary wide donebig" onClick={lock}>
          Done · next person
        </button>
        <p className="sub small">Returning to the PIN pad in {countdown}s.</p>
      </section>
    );
  else if (screen === "clockedin" && shift)
    content = (
      <section className="successbox">
        <div className="successmark">✓</div>
        <span className="eyebrow">CLOCKED IN</span>
        <h1>You&apos;re on the clock, {worker?.name?.split(" ")[0]}.</h1>
        <div className="receipt">
          <div className="between">
            <span>Role</span>
            <strong>{shift.segments.at(-1)?.role_name}</strong>
          </div>
          <div className="between">
            <span>Clock-in</span>
            <span>{time(shift.started_at)}</span>
          </div>
        </div>
        <button className="primary wide donebig" onClick={lock}>
          Done · next person
        </button>
        <button className="wide" onClick={() => setScreen("shift")}>
          View my shift and responsibilities
        </button>
        <p className="sub small">Returning to the PIN pad in {countdown}s.</p>
      </section>
    );
  else if (!data?.authenticated)
    content = (
      <section className="kiosk">
        <div className="intro">
          <div className="location">
            <span className="pill">{data?.kiosk?.label || "FRONT ROOM"}</span>
            <span className="sub">Austin, TX</span>
          </div>
          <span className="eyebrow">STARDUST GARAGE TIME CLOCK</span>
          <h1>Your shift starts here.</h1>
          <p className="muted">
            Enter your PIN to clock in, manage your shift, or clock out.
          </p>
          <ol className="steps">
            <li>
              <span>1</span>Enter your personal PIN
            </li>
            <li>
              <span>2</span>Choose the role you&apos;re working
            </li>
            <li>
              <span>3</span>Clock in and review your responsibilities
            </li>
          </ol>
          <div className="clockline">
            <div className="clock mono">{time(now)}</div>
            <div className="sub">{date(now)} · Austin time</div>
          </div>
        </div>
        <form
          className="pinpanel"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.length === PIN_LENGTH) identify();
          }}
        >
          <h2>Enter your {PIN_LENGTH}-digit PIN</h2>
          <p className="sub">Your time. Your shift.</p>
          <div
            className="pin-dots"
            role="status"
            aria-label={`${pin.length} of ${PIN_LENGTH} PIN digits entered`}
          >
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <i key={i} className={i < pin.length ? "filled" : ""} />
            ))}
          </div>
          <div className="keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, "Clear", 0, "Delete"].map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() =>
                  setPin((p) =>
                    k === "Clear"
                      ? ""
                      : k === "Delete"
                        ? p.slice(0, -1)
                        : (p + k).slice(0, PIN_LENGTH),
                  )
                }
              >
                {k}
              </button>
            ))}
          </div>
          <button
            className="primary wide"
            disabled={pin.length !== PIN_LENGTH || busy || !online}
          >
            {busy ? "Checking…" : "Continue"}
          </button>
          <button
            type="button"
            className="textbtn wide"
            onClick={() => setScreen("help")}
          >
            Forgot PIN or need help?
          </button>
        </form>
      </section>
    );
  else if (screen === "roles")
    content = (
      <section className="workspace">
        {header}
        <span className="eyebrow">{shift ? "SWITCH ROLE" : "CLOCK IN"}</span>
        <h2>What role are you working?</h2>
        <p className="sub">
          Only assigned roles are shown. Time begins when the server confirms
          Clock in.
        </p>
        <div className="roles">
          {data.roles
            .filter((r) => !shift || r.id !== shift.segments.at(-1)?.role_id)
            .map((r) => (
              <button
                type="button"
                key={r.id}
                disabled={disabled}
                className={`role ${role === r.id ? "selected" : ""}`}
                aria-pressed={role === r.id}
                onClick={() => setRole(r.id)}
              >
                <b>{r.name}</b>
                <span className="sub">{r.tasks.length} responsibilities</span>
              </button>
            ))}
        </div>
        {!data.roles.length && (
          <div className="notice">
            No roles assigned. Ask the owner before beginning work.
          </div>
        )}
        <div className="role-actions">
          <span className="sub">
            {shift
              ? "Role time changes without a gap."
              : "Review your responsibilities after clocking in."}
          </span>
          <button
            className="primary"
            disabled={!role || disabled}
            onClick={() =>
              operate(shift ? "switch_role" : "clock_in", {
                ...(shift ? { shift_id: shift.id } : {}),
                role_id: role,
              })
            }
          >
            {busy ? "Saving…" : shift ? "Switch role" : "Clock in"}
          </button>
        </div>
        {shift && (
          <button className="textbtn" onClick={() => setScreen("shift")}>
            Back to shift
          </button>
        )}
      </section>
    );
  else if (screen === "history")
    content = (
      <section className="workspace">
        {header}
        <h2>Your recent shifts</h2>
        <ShiftTable shifts={data.history || []} />
        <button onClick={() => setScreen(shift ? "shift" : "roles")}>
          Back
        </button>
      </section>
    );
  else if (screen === "clockout" && shift)
    content = (
      <section className="helpbox">
        {header}
        <h2>Review your shift</h2>
        <div className="panel">
          <div className="between">
            <span>Time on shift</span>
            <strong>{duration(elapsedMs(shift, now))}</strong>
          </div>
          <div className="notice">
            {shift.tasks.filter((t) => !t.done).length} responsibilities not
            marked complete. You can still clock out.
          </div>
          <label className="note" htmlFor="handoff">
            Shift handoff (optional)
          </label>
          <textarea
            id="handoff"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="primary wide"
            disabled={disabled}
            onClick={() => operate("clock_out", { shift_id: shift.id, note })}
          >
            {busy ? "Saving…" : "Confirm clock-out"}
          </button>
          <button
            disabled={busy}
            className="textbtn wide"
            onClick={() => setScreen("shift")}
          >
            Back to shift
          </button>
        </div>
      </section>
    );
  else if (shift)
    content = (
      <section className="workspace">
        {header}
        <div className="shiftgrid">
          <section className="panel">
            <div className="between">
              <span className="eyebrow">CURRENT SHIFT</span>
              <Status shift={shift} />
            </div>
            <div className="shiftstat mono">
              {duration(elapsedMs(shift, now))}
            </div>
            <p className="sub">
              Clocked in {time(shift.started_at)} · {date(shift.started_at)}
            </p>
            <h2>{shift.segments.at(-1)?.role_name}</h2>
            <div className="shift-actions">
              <button
                disabled={disabled}
                onClick={() =>
                  operate(onBreak ? "break_end" : "break_start", {
                    shift_id: shift.id,
                  })
                }
              >
                {onBreak ? "End break" : "Start break"}
              </button>
              <button
                disabled={
                  disabled ||
                  onBreak ||
                  !data.roles.some(
                    (r) => r.id !== shift.segments.at(-1)?.role_id,
                  )
                }
                onClick={() => {
                  setRole("");
                  setScreen("roles");
                }}
              >
                Switch role
              </button>
            </div>
            <button
              className="primary wide"
              disabled={disabled}
              onClick={() => setScreen("clockout")}
            >
              Clock out
            </button>
            <button
              className="textbtn wide"
              onClick={() => setScreen("history")}
            >
              View my recent shifts
            </button>
            <div className="notice">
              Breaks are logged and remain counted time. No automatic
              deductions.
            </div>
          </section>
          <section className="panel">
            <div className="between">
              <h2>Shift responsibilities</h2>
              <span className="sub">
                {shift.tasks.filter((t) => t.done).length}/{shift.tasks.length}
              </span>
            </div>
            {shift.tasks.map((t) => (
              <label key={t.id} className="task">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={t.done}
                  onChange={(e) =>
                    operate("task", {
                      shift_id: shift.id,
                      task_id: t.id,
                      done: e.target.checked,
                    })
                  }
                />
                <span>{t.title}</span>
              </label>
            ))}
            <label className="note" htmlFor="shift-note">
              Shift notes
            </label>
            <textarea
              id="shift-note"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Supplies, maintenance, or a handoff..."
            />
            <button
              disabled={disabled || note === shift.note}
              onClick={() => operate("note", { shift_id: shift.id, note })}
            >
              Save note
            </button>
            <span className="sub small">
              {note === shift.note ? " Note saved." : " Unsaved note."}
            </span>
          </section>
        </div>
        <button className="primary wide donebig donebar" disabled={busy} onClick={done}>
          Done · back to PIN pad
        </button>
        <p className="sub small">
          Tap Done when you are finished so the next person can clock in. The
          screen also locks after 90 seconds of inactivity. Your shift keeps
          running.
        </p>
      </section>
    );
  else
    content = (
      <section className="panel">
        <h2>No shift is open.</h2>
        <button onClick={() => setScreen("roles")}>Choose role</button>
        <button onClick={() => setScreen("history")}>Recent shifts</button>
      </section>
    );
  return (
    <Frame>
      {!online && (
        <div className="notice" role="alert">
          Offline. No punches can be confirmed. Ask the owner to record any
          missed time.
        </div>
      )}
      {error && (
        <div className="notice tc-error" role="alert">
          {error}
        </div>
      )}
      {pending && !busy && (
        <div className="notice" role="alert">
          <p>
            Outcome not confirmed. Do not start a different action. Retry uses
            the same request ID to prevent a duplicate punch.
          </p>
          <button
            onClick={() => operate(null, null, pending)}
            disabled={!online}
          >
            Retry same action
          </button>
          <button onClick={lock}>Lock and check status with PIN</button>
        </div>
      )}
      {content}
    </Frame>
  );
}
