"use client";

import { useEffect, useRef } from "react";
import { money } from "@/app/components/time-clock/Shared";

// Read-only staff profile card. Opens when a manager clicks a staff row; the
// gear switches to the edit form. Photo and birthday are employee-supplied
// and private to Staff managers.
const titleCase = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);
function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter((part) => /^\p{L}/u.test(part));
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase() || "?";
}
export function birthdayText(ymd, today = new Date()) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  const [ty, tm, td] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" })
    .format(today)
    .split("-")
    .map(Number);
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return { label, age };
}
const PAY = { hourly: "Hourly by role", flat: "Flat shift fee", unset: "Not configured" };

export default function StaffProfile({ worker: w, data, onEdit, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [w.id]);
  const roleName = (id) => data.roles.find((r) => r.id === id)?.name || id;
  const roles = data.assignments
    .filter((a) => a.worker_id === w.id)
    .sort((a, b) => roleName(a.role_id).localeCompare(roleName(b.role_id)));
  const bday = birthdayText(w.birthdate);
  const login = w.has_login
    ? w.login_enabled === false
      ? "Disabled"
      : "Enabled"
    : w.invite
      ? Date.parse(w.invite.expires_at) > Date.now()
        ? "Invite sent"
        : "Invite expired"
      : "Not set up";
  const idLine = [
    w.has_login ? w.username || w.login_email : null,
    w.has_pin ? (w.pin_set_by_employee_at ? "PIN set by employee" : "PIN set") : "No PIN yet",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section ref={ref} id="staff-profile" className="panel sp-card" aria-label={`${w.name} profile`}>
      <div className="sp-top">
        <div className="sp-photo">
          {w.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.photo_url} alt={`${w.name} photo`} />
          ) : (
            <span aria-hidden="true">{initials(w.name)}</span>
          )}
        </div>
        <div className="sp-id">
          <h2>{w.name}</h2>
          <div className="sp-chips">
            <span className="sp-chip">{titleCase(w.category)}</span>
            <span className={`sp-chip${w.active ? " ok" : ""}`}>{w.active ? "Active" : "Inactive"}</span>
          </div>
          <p className="sub">{idLine}</p>
        </div>
        <div className="sp-acts">
          <span className="tc-tip" data-tip="Edit profile">
            <button type="button" className="tc-iconbtn" aria-label="Edit profile" onClick={onEdit}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
          </span>
          <span className="tc-tip" data-tip="Close">
            <button type="button" className="tc-iconbtn" aria-label="Close profile" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        </div>
      </div>
      <div className="sp-facts">
        <div className="sp-fact">
          <span>Birthday</span>
          <b>{bday ? bday.label : "Not added yet"}</b>
          {bday && <small> · {bday.age}</small>}
        </div>
        <div className="sp-fact">
          <span>Pay basis</span>
          <b>{PAY[w.pay_basis] || PAY.unset}</b>
        </div>
        <div className="sp-fact">
          <span>Login</span>
          <b>{login}</b>
        </div>
      </div>
      <div className="sp-sec">
        <div className="sp-label">Roles and pay</div>
        {roles.length ? (
          roles.map((a, i) => (
            <div className="sp-role" key={a.role_id}>
              <span>{roleName(a.role_id)}</span>
              <span className="mono sub">
                {w.pay_basis === "hourly"
                  ? a.rate_cents === null
                    ? "Rate not set"
                    : `${money(a.rate_cents)}/hr`
                  : w.pay_basis === "flat" && i === 0
                    ? `${money(w.flat_cents)} / shift`
                    : ""}
              </span>
            </div>
          ))
        ) : (
          <p className="sub">No roles assigned.</p>
        )}
      </div>
      <p className="sub sp-foot">
        {w.photo_url
          ? "Photo and birthday are private and visible only to managers."
          : "Photo and birthday are private and visible only to managers. The employee adds their photo from their invite or the staff portal."}
      </p>
    </section>
  );
}
