"use client";

import { useState } from "react";
import { request } from "@/app/components/time-clock/Shared";
import { dollarsToCents } from "@/lib/time-clock/core.mjs";

/**
 * Minimal staff profile for someone who is not on the list yet: name,
 * Employee/Contractor, one role and pay. No PIN or login is created — the
 * manager can send an invite from Staff profiles later. Calls onCreated with
 * the new profile's id and role once saved.
 */
export default function QuickAddPerson({ roles, defaultRole, onCreated, onCancel }) {
  const active = roles.filter((r) => r.active);
  const [form, setForm] = useState({
    name: "",
    category: "contractor",
    role_id: defaultRole && active.some((r) => r.id === defaultRole) ? defaultRole : active[0]?.id || "",
    pay_basis: "hourly",
    amount: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (busy) return;
    setError("");
    try {
      if (!form.name.trim()) throw new Error("Enter their name.");
      if (!form.role_id) throw new Error("Choose a role.");
      const cents = dollarsToCents(form.amount.trim().replace(/^\$/, ""));
      if (form.pay_basis === "flat" && cents === null) throw new Error("Enter the flat shift fee.");
      setBusy(true);
      const result = await request("/api/admin/time-clock", {
        action: "save_worker",
        payload: {
          name: form.name.trim(),
          category: form.category,
          active: true,
          pay_basis: cents === null ? "unset" : form.pay_basis,
          flat_cents: form.pay_basis === "flat" ? cents : null,
          roles: [{ role_id: form.role_id, rate_cents: form.pay_basis === "hourly" ? cents : null }],
        },
      });
      await onCreated(result.id, form.role_id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  // A <div>, not a <form>: this sits inside the Add shift / Add hours forms.
  return (
    <div className="qa-person" role="group" aria-label="New person">
      <div className="qa-grid">
        <label className="qa-wide">Full name
          <input autoFocus maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        </label>
        <label>Type
          <select value={form.category} onChange={(e) => set("category", e.target.value)}>
            <option value="contractor">Contractor</option>
            <option value="employee">Employee</option>
          </select>
        </label>
        <label>Role
          <select value={form.role_id} onChange={(e) => set("role_id", e.target.value)}>
            {active.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label>Pay
          <select value={form.pay_basis} onChange={(e) => set("pay_basis", e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="flat">Flat per shift</option>
          </select>
        </label>
        <label>{form.pay_basis === "flat" ? "Fee ($)" : "Rate ($/hr)"}
          <input inputMode="decimal" placeholder={form.pay_basis === "flat" ? "150.00" : "Optional"} value={form.amount}
            onChange={(e) => set("amount", e.target.value)} />
        </label>
      </div>
      <div className="row wrap">
        <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add person"}</button>
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <p className="sub small">Creates a staff profile with no PIN or login. Send an invite from Staff profiles if they need the iPad.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
