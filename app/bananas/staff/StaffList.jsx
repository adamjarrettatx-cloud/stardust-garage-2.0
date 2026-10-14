"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { request, money } from "@/app/components/time-clock/Shared";

const loginEndpoint = "/api/admin/time-clock/login";
const inviteEndpoint = "/api/admin/time-clock/invite";
const shortDate = (iso) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }).format(new Date(iso));
function expiresIn(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return null;
  const h = Math.ceil(ms / 3600000);
  return h >= 48 ? `Expires in ${Math.floor(h / 24)} days` : h > 1 ? `Expires in ${h} hours` : "Expires within an hour";
}
const SIGN_IN = "sdgatx.com/employee/login";

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter((part) => /^\p{L}/u.test(part));
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase() || "?";
}
const titleCase = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

// Staff profiles as a single scannable list. Each row: identity, roles and
// rates, pay basis, employee-login state, then Edit plus a ••• menu holding
// Reset PIN and the login actions. Clicking the row opens the read-only
// profile card; Edit opens the form directly. Login create/reset/enable/remove calls are unchanged from the
// previous card layout.
export default function StaffList({ data, busy, run, onOpen, onEdit, onResetPin, onDone }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [category, setCategory] = useState("all"),
    [menu, setMenu] = useState(null),
    [loginForm, setLoginForm] = useState(null),
    [inviteForm, setInviteForm] = useState(null);
  const listRef = useRef(null);

  // Close the ••• menu on outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    function away(e) {
      if (!e.target.closest?.(`[data-menu="${menu}"]`)) setMenu(null);
    }
    function esc(e) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const roleName = (id) => data.roles.find((r) => r.id === id)?.name || "Role";
  const assignmentsFor = (w) =>
    data.assignments
      .filter((a) => a.worker_id === w.id)
      .sort((a, b) => roleName(a.role_id).localeCompare(roleName(b.role_id)));

  const sorted = useMemo(
    () => [...data.workers].sort((a, b) => a.name.localeCompare(b.name)),
    [data.workers],
  );
  const counts = {
    all: sorted.length,
    active: sorted.filter((w) => w.active).length,
    inactive: sorted.filter((w) => !w.active).length,
  };
  const q = query.trim().toLowerCase();
  const rows = sorted.filter((w) => {
    if (status === "active" && !w.active) return false;
    if (status === "inactive" && w.active) return false;
    if (category !== "all" && w.category !== category) return false;
    if (!q) return true;
    if (w.name.toLowerCase().includes(q)) return true;
    return assignmentsFor(w).some((a) => roleName(a.role_id).toLowerCase().includes(q));
  });

  const call = (w, action, payload = {}) =>
    request(loginEndpoint, { action, payload: { worker_id: w.id, ...payload } });
  const invite = (w, action, payload = {}) =>
    request(inviteEndpoint, { action, payload: { worker_id: w.id, ...payload } });

  function sendInvite(e, w) {
    e.preventDefault();
    run(async () => {
      const r = await invite(w, "send", { email: inviteForm.email });
      setInviteForm(null);
      await onDone({ notice: r.text });
    });
  }
  function resendInvite(w) {
    run(async () => {
      const r = await invite(w, "resend");
      await onDone({ notice: r.text });
    });
  }
  function cancelInvite(w) {
    if (!window.confirm(`Cancel ${w.name}'s invite? The emailed link will stop working.`)) return;
    run(async () => {
      const r = await invite(w, "cancel");
      await onDone({ notice: r.text });
    });
  }
  function sendPinReset(w) {
    if (!window.confirm(`Email ${w.name} a link to choose a new PIN? Their current PIN keeps working until they do.`)) return;
    run(async () => {
      const r = await invite(w, "pin_reset");
      await onDone({ notice: r.text });
    });
  }
  const openInvite = (w) => {
    setMenu(null);
    setLoginForm(null);
    setInviteForm({ id: w.id, email: w.invite?.email || "" });
  };
  const loginId = (w) => w.username || w.login_email;

  function createLogin(e, w) {
    e.preventDefault();
    const form = loginForm.values;
    run(async () => {
      const r = await call(w, "create", form);
      setLoginForm(null);
      if (r.linked_existing) return onDone({ notice: r.text });
      await onDone({
        disclosure: {
          title: `Employee login for ${w.name}`,
          value: r.password,
          text: `Sign in at ${SIGN_IN} with ${r.username ? `username “${r.username}”` : r.email}${r.username && r.email ? ` or ${r.email}` : ""} and this password. Share it privately; it will not be shown again. They can change it after signing in.`,
        },
      });
    });
  }
  function resetPassword(w) {
    if (!window.confirm(`Reset ${w.name}'s employee password? Their current password will stop working.`)) return;
    run(async () => {
      const r = await call(w, "reset_password");
      await onDone({
        disclosure: {
          title: `New employee password for ${w.name}`,
          value: r.password,
          text: `Sign in at ${SIGN_IN} with ${loginId(w)}. Share it privately; it will not be shown again.`,
        },
      });
    });
  }
  function toggleLogin(w) {
    run(async () => {
      await call(w, "set_enabled", { enabled: !w.login_enabled });
      await onDone({ notice: `Employee login ${w.login_enabled ? "disabled" : "enabled"} for ${w.name}.` });
    });
  }
  function removeLogin(w) {
    if (!window.confirm(`Remove ${w.name}'s employee login? Their schedule and hours stay saved.`)) return;
    run(async () => {
      await call(w, "remove");
      await onDone({ notice: `Employee login removed for ${w.name}.` });
    });
  }
  const openCreate = (w) => {
    setMenu(null);
    setInviteForm(null);
    setLoginForm({ id: w.id, values: { username: "", email: "", password: "" } });
  };
  const setLoginField = (k, v) =>
    setLoginForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));

  function rowClick(e, w) {
    if (e.target.closest("button, a, input, select, label, form, .sl-menu")) return;
    (onOpen || onEdit)(w);
  }
  function pick(fn) {
    setMenu(null);
    fn();
  }

  if (!data.workers.length) return null;

  return (
    <div className="sl">
      <div className="sl-toolbar">
        <label className="sl-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="Search staff or role"
            placeholder="Search staff or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="sl-seg" role="group" aria-label="Status">
          {[
            ["all", "All"],
            ["active", "Active"],
            ["inactive", "Inactive"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={status === key}
              className={status === key ? "on" : ""}
              onClick={() => setStatus(key)}
            >
              {label}
              <b>{counts[key]}</b>
            </button>
          ))}
        </div>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          <option value="employee">Employees</option>
          <option value="contractor">Contractors</option>
        </select>
        <span className="sl-count">Sorted by name</span>
      </div>

      <div className="sl-list" ref={listRef}>
        <div className="sl-cols" aria-hidden="true">
          <span>Name</span>
          <span>Roles</span>
          <span>Pay basis</span>
          <span>Employee login</span>
          <span className="right">Actions</span>
        </div>
        {rows.map((w) => {
          const roles = assignmentsFor(w);
          const open = menu === w.id;
          const formOpen = loginForm?.id === w.id;
          const inviteOpen = inviteForm?.id === w.id;
          const invited = !w.has_login && w.invite;
          const inviteLeft = invited ? expiresIn(w.invite.expires_at) : null;
          const loginState = w.has_login
            ? w.login_enabled ? "ok" : "off"
            : invited && inviteLeft ? "wait" : "";
          const loginLabel = w.has_login
            ? w.login_enabled ? "Enabled" : "Disabled"
            : invited
              ? inviteLeft ? `Invited · ${shortDate(w.invite.sent_at)}` : "Invite expired"
              : "Not set up";
          const rateText = (a) =>
            w.pay_basis === "hourly"
              ? a.rate_cents === null
                ? "Rate not set"
                : `${money(a.rate_cents)}/hr`
              : "";
          // Pay basis shows only the amount: per-role hourly rates on each
          // role's line, or the flat shift fee once. No "Hourly by role" label.
          const payText =
            w.pay_basis === "flat"
              ? `${money(w.flat_cents)} / shift`
              : w.pay_basis === "hourly"
                ? ""
                : "Pay not configured";
          const lines = roles.length
            ? roles.map((a, i) => ({
                key: a.role_id,
                role: roleName(a.role_id),
                pay: w.pay_basis === "hourly" ? rateText(a) : i === 0 ? payText : "",
                unset: w.pay_basis === "hourly" ? a.rate_cents === null : w.pay_basis === "unset",
              }))
            : [{ key: "none", role: null, pay: payText || "—", unset: w.pay_basis !== "flat" }];
          return (
            <div key={w.id} className={`sl-item${w.active ? "" : " inactive"}${open ? " menu-open" : ""}`} onClick={(e) => rowClick(e, w)}>
              <div className="sl-who">
                <span className="sl-av" aria-hidden="true">
                  {w.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.photo_url} alt="" />
                  ) : (
                    initials(w.name)
                  )}
                </span>
                <div>
                  <b>
                    {w.name}
                    {!w.active && <span className="sl-status">Inactive</span>}
                  </b>
                  <small>
                    {titleCase(w.category)} · {w.active ? (w.has_pin ? "Active" : "No PIN yet") : "PIN access blocked"}
                  </small>
                </div>
              </div>
              <div className="sl-rolepay">
                {lines.map((l) => (
                  <div className="sl-line" key={l.key}>
                    <span className={l.role ? "sl-role" : "sl-role muted"}>{l.role || "No roles assigned"}</span>
                    <span className={`sl-rate mono${l.unset ? " muted" : ""}`}>{l.pay}</span>
                  </div>
                ))}
              </div>
              <div className="sl-login">
                {w.has_login && <span className="sl-id">{loginId(w) || "Linked account"}</span>}
                <span className={`sl-dot ${loginState}`}>{loginLabel}</span>
                {invited && inviteLeft && <small className="sl-sub">{inviteLeft}</small>}
                {w.has_login && w.pin_set_by_employee_at && <small className="sl-sub">PIN set by employee</small>}
                {w.has_login && w.pin_invite && <small className="sl-sub">PIN reset sent · {shortDate(w.pin_invite.sent_at)}</small>}
                {!w.has_login && w.active && !formOpen && !inviteOpen && (
                  <button type="button" className="sl-link" disabled={busy} onClick={() => (invited && !inviteLeft ? resendInvite(w) : openInvite(w))}>
                    {invited ? (inviteLeft ? "Change email" : "Resend invite") : "Invite"}
                  </button>
                )}
              </div>
              <div className="sl-acts" data-menu={w.id}>
                <button type="button" className="sl-edit" onClick={() => onEdit(w)}>
                  Edit
                </button>
                <button
                  type="button"
                  className={`sl-more${open ? " open" : ""}`}
                  aria-label={`More actions for ${w.name}`}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={() => setMenu(open ? null : w.id)}
                >
                  <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true">
                    <circle cx="2" cy="2" r="1.6" fill="currentColor" />
                    <circle cx="8" cy="2" r="1.6" fill="currentColor" />
                    <circle cx="14" cy="2" r="1.6" fill="currentColor" />
                  </svg>
                </button>
                {open && (
                  <div className="sl-menu" role="menu">
                    <button type="button" role="menuitem" className="sl-only-mobile" onClick={() => pick(() => onEdit(w))}>
                      Edit profile
                    </button>
                    {w.has_login && w.login_email && (
                      <button type="button" role="menuitem" disabled={busy || !w.active} onClick={() => pick(() => sendPinReset(w))}>
                        Send PIN reset email
                      </button>
                    )}
                    <button type="button" role="menuitem" disabled={busy} onClick={() => pick(() => onResetPin(w))}>
                      {w.has_pin ? "Set PIN manually" : "Set PIN"}
                    </button>
                    <hr />
                    <div className="sl-menulabel">Employee login</div>
                    {!w.has_login && !w.invite && (
                      <button type="button" role="menuitem" disabled={busy || !w.active} onClick={() => openInvite(w)}>
                        Invite by email
                      </button>
                    )}
                    {!w.has_login && w.invite && (
                      <button type="button" role="menuitem" disabled={busy || !w.active} onClick={() => pick(() => resendInvite(w))}>
                        Resend invite
                      </button>
                    )}
                    {!w.has_login && w.invite && (
                      <button type="button" role="menuitem" disabled={busy} onClick={() => pick(() => cancelInvite(w))}>
                        Cancel invite
                      </button>
                    )}
                    {!w.has_login && (
                      <button type="button" role="menuitem" disabled={busy || !w.active} onClick={() => openCreate(w)}>
                        Create username login
                      </button>
                    )}
                    {w.has_login && w.login_managed && (
                      <button type="button" role="menuitem" disabled={busy} onClick={() => pick(() => resetPassword(w))}>
                        Reset password
                      </button>
                    )}
                    {w.has_login && (
                      <button type="button" role="menuitem" disabled={busy} onClick={() => pick(() => toggleLogin(w))}>
                        {w.login_enabled ? "Disable login" : "Enable login"}
                      </button>
                    )}
                    {w.has_login && (
                      <button type="button" role="menuitem" className="sl-danger" disabled={busy} onClick={() => pick(() => removeLogin(w))}>
                        Remove login
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="sl-mmeta">
                {roles.map((a) => (
                  <span key={a.role_id}>
                    {roleName(a.role_id)}
                    {rateText(a) && ` · ${rateText(a)}`}
                  </span>
                ))}
                {payText && <span>{payText}</span>}
                {!w.has_login && <span className={`sl-dot ${loginState}`}>{invited ? loginLabel : "Login not set up"}</span>}
                {w.has_login && <span className={`sl-dot ${loginState}`}>Login {loginLabel.toLowerCase()}</span>}
              </div>
              {inviteOpen && (
                <form className="tc-form sl-loginform" onSubmit={(e) => sendInvite(e, w)}>
                  <h3>Invite {w.name}</h3>
                  <label>
                    Email
                    <input
                      type="email"
                      required
                      autoFocus
                      autoComplete="off"
                      maxLength={254}
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </label>
                  <p className="sub">
                    They&apos;ll get a link to set their password, iPad PIN, birthday and private photo. The link expires in
                    72 hours. If this email already has an SDG account, it&apos;s linked and keeps its password.
                  </p>
                  <div className="row wrap">
                    <button className="primary" disabled={busy}>{w.invite ? "Send new invite" : "Send invite"}</button>
                    <button type="button" disabled={busy} onClick={() => setInviteForm(null)}>Cancel</button>
                    <button type="button" className="sl-link sl-alt" disabled={busy} onClick={() => openCreate(w)}>
                      No email? Create username login instead
                    </button>
                  </div>
                </form>
              )}
              {formOpen && (
                <form className="tc-form sl-loginform" onSubmit={(e) => createLogin(e, w)}>
                  <h3>Create employee login for {w.name}</h3>
                  <div className="sl-loginfields">
                    <label>
                      Username
                      <input
                        autoCapitalize="none"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={32}
                        value={loginForm.values.username}
                        onChange={(e) => setLoginField("username", e.target.value)}
                        placeholder="e.g. avery"
                      />
                    </label>
                    <label>
                      Email (optional)
                      <input
                        type="email"
                        autoComplete="off"
                        maxLength={254}
                        value={loginForm.values.email}
                        onChange={(e) => setLoginField("email", e.target.value)}
                      />
                    </label>
                    <label>
                      Password (optional)
                      <input
                        type="text"
                        autoComplete="new-password"
                        minLength={10}
                        maxLength={72}
                        value={loginForm.values.password}
                        onChange={(e) => setLoginField("password", e.target.value)}
                        placeholder="Leave blank to generate"
                      />
                    </label>
                  </div>
                  <p className="sub">If this email already has an SDG account, it is linked and keeps its current password.</p>
                  <div className="row wrap">
                    <button className="primary" disabled={busy}>Create login</button>
                    <button type="button" disabled={busy} onClick={() => setLoginForm(null)}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
        {!rows.length && <div className="empty">No staff match these filters.</div>}
      </div>
      <p className="tablefoot">Pay amounts are base estimates, not payroll. Rate edits apply to future shifts only.</p>
    </div>
  );
}
