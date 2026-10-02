"use client";

import { useState } from "react";
import { request } from "@/app/components/time-clock/Shared";

const endpoint = "/api/admin/time-clock/login";
const SIGN_IN = "sdgatx.com/employee/login";

// Employee portal login controls on a staff profile card. Creating a login
// lets that person sign in to /employee and see ONLY their own schedule,
// hours and pay estimates. It grants no other SDG access.
export default function EmployeeLogin({ worker: w, busy, run, onDone }) {
  const [form, setForm] = useState(null);
  const call = (action, payload = {}) =>
    request(endpoint, { action, payload: { worker_id: w.id, ...payload } });
  const id = w.username || w.login_email;

  function create(e) {
    e.preventDefault();
    run(async () => {
      const r = await call("create", form);
      setForm(null);
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
  function reset() {
    if (!window.confirm(`Reset ${w.name}'s employee password? Their current password will stop working.`)) return;
    run(async () => {
      const r = await call("reset_password");
      await onDone({
        disclosure: {
          title: `New employee password for ${w.name}`,
          value: r.password,
          text: `Sign in at ${SIGN_IN} with ${id}. Share it privately; it will not be shown again.`,
        },
      });
    });
  }
  function toggle() {
    run(async () => {
      await call("set_enabled", { enabled: !w.login_enabled });
      await onDone({ notice: `Employee login ${w.login_enabled ? "disabled" : "enabled"} for ${w.name}.` });
    });
  }
  function remove() {
    if (!window.confirm(`Remove ${w.name}'s employee login? Their schedule and hours stay saved.`)) return;
    run(async () => {
      await call("remove");
      await onDone({ notice: `Employee login removed for ${w.name}.` });
    });
  }

  return (
    <div className="emp-login">
      <p className="sub" style={{ marginTop: 16, marginBottom: 8 }}>
        <b>Employee login: </b>
        {w.has_login
          ? `${id || "linked account"} · ${w.login_enabled ? "Enabled" : "Disabled"}`
          : "Not set up"}
      </p>
      {!w.has_login && !form && (
        <button disabled={busy || !w.active} onClick={() => setForm({ username: "", email: "", password: "" })}>
          Create employee login
        </button>
      )}
      {form && (
        <form className="tc-form" style={{ marginBlock: 8 }} onSubmit={create}>
          <label>
            Username
            <input
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. avery"
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              autoComplete="off"
              maxLength={254}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <span className="sub">If this email already has an SDG account, it is linked and keeps its current password.</span>
          </label>
          <label>
            Password (optional)
            <input
              type="text"
              autoComplete="new-password"
              minLength={10}
              maxLength={72}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Leave blank to generate"
            />
          </label>
          <div className="row wrap">
            <button className="primary" disabled={busy}>Create login</button>
            <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
      {w.has_login && (
        <div className="row wrap">
          {w.login_managed && <button disabled={busy} onClick={reset}>Reset password</button>}
          <button disabled={busy} onClick={toggle}>{w.login_enabled ? "Disable login" : "Enable login"}</button>
          <button disabled={busy} onClick={remove}>Remove login</button>
        </div>
      )}
    </div>
  );
}
