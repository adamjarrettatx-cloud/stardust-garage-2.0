"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { request, money } from "@/app/components/time-clock/Shared";

const loginEndpoint = "/api/admin/time-clock/login";
const SIGN_IN = "sdgatx.com/employee/login";

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter((part) => /^\p{L}/u.test(part));
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase() || "?";
}
const titleCase = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

// Staff profiles as a single scannable list. Each row: identity, roles and
// rates, pay basis, employee-login state, then Edit plus a ••• menu holding
// Reset PIN, View as employee and the login actions. The row itself also
// opens Edit. Login create/reset/enable/remove calls are unchanged from the
// previous card layout.
export default function StaffList({ data, busy, run, onEdit, onResetPin, onDone }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [category, setCategory] = useState("all"),
    [menu, setMenu] = useState(null),
    [loginForm, setLoginForm] = useState(null);
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
    setLoginForm({ id: w.id, values: { username: "", email: "", password: "" } });
  };
  const setLoginField = (k, v) =>
    setLoginForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));

  function rowClick(e, w) {
    if (e.target.closest("button, a, input, select, label, form, .sl-menu")) return;
    onEdit(w);
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
          <span>Roles &amp; rates</span>
          <span>Pay basis</span>
          <span>Employee login</span>
          <span className="right">Actions</span>
        </div>
        {rows.map((w) => {
          const roles = assignmentsFor(w);
          const open = menu === w.id;
          const formOpen = loginForm?.id === w.id;
          const loginState = w.has_login ? (w.login_enabled ? "ok" : "off") : "";
          const loginLabel = w.has_login ? (w.login_enabled ? "Enabled" : "Disabled") : "Not set up";
          const rateText = (a) =>
            w.pay_basis === "hourly"
              ? a.rate_cents === null
                ? "Rate not set"
                : `${money(a.rate_cents)}/hr`
              : "";
          const payText =
            w.pay_basis === "flat"
              ? `${money(w.flat_cents)} / shift`
              : w.pay_basis === "hourly"
                ? "Hourly by role"
                : "Pay not configured";
          return (
            <div key={w.id} className={`sl-item${w.active ? "" : " inactive"}${open ? " menu-open" : ""}`} onClick={(e) => rowClick(e, w)}>
              <div className="sl-who">
                <span className="sl-av" aria-hidden="true">{initials(w.name)}</span>
                <div>
                  <b>
                    {w.name}
                    {!w.active && <span className="sl-status">Inactive</span>}
                  </b>
                  <small>
                    {titleCase(w.category)} · {w.active ? "Active" : "PIN access blocked"}
                  </small>
                </div>
              </div>
              <div className="sl-roles">
                {roles.length ? (
                  roles.map((a) => (
                    <div key={a.role_id}>
                      <span>{roleName(a.role_id)}</span>
                      {rateText(a) && <span className="mono">{rateText(a)}</span>}
                    </div>
                  ))
                ) : (
                  <span className="muted">No roles assigned</span>
                )}
              </div>
              <div className={`sl-pay${w.pay_basis === "unset" ? " muted" : ""}`}>
                <strong>{payText}</strong>
                {w.pay_basis === "flat" && <span>Flat shift fee</span>}
              </div>
              <div className="sl-login">
                {w.has_login && <span className="sl-id">{loginId(w) || "Linked account"}</span>}
                <span className={`sl-dot ${loginState}`}>{loginLabel}</span>
                {!w.has_login && w.active && !formOpen && (
                  <button type="button" className="sl-link" disabled={busy} onClick={() => openCreate(w)}>
                    Create login
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
                    <button type="button" role="menuitem" disabled={busy} onClick={() => pick(() => onResetPin(w))}>
                      Reset PIN
                    </button>
                    {w.active && (
                      <a role="menuitem" href={`/bananas/timekeeping/employee-view?worker=${w.id}`}>
                        View as employee
                      </a>
                    )}
                    <hr />
                    <div className="sl-menulabel">Employee login</div>
                    {!w.has_login && (
                      <button type="button" role="menuitem" disabled={busy || !w.active} onClick={() => openCreate(w)}>
                        Create employee login
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
                <span>
                  {w.pay_basis === "flat" ? `${titleCase(w.category)} · ${payText}` : payText}
                  {!w.has_login && " · Login not set up"}
                </span>
                {w.has_login && <span className={`sl-dot ${loginState}`}>Login {loginLabel.toLowerCase()}</span>}
              </div>
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
