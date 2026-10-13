"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Roles & duties as a list + detail view. The left column lists every role
// with its duty and staff counts; the right column shows the selected role's
// numbered shift checklist and assigned staff, or the inline editor. Saving
// still sends the same save_role payload ({ id, name, active, tasks[] }).

const MAX_TASKS = 30;
const MAX_TASK_LEN = 240;

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase() || "?";
}
// Role IDs must match /^[a-z_]{2,40}$/ on the server.
export function roleIdFromName(name = "") {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
}
const dutyLabel = (n) => (n === 1 ? "1 duty" : `${n} duties`);

const Icon = {
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  chev: (
    <svg className="rd-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  back: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  ),
  up: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 15 6-6 6 6" />
    </svg>
  ),
  down: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  remove: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
};

export default function RolesPanel({ data, busy, onSave, onError }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState(null),
    [mobileOpen, setMobileOpen] = useState(false),
    [draft, setDraft] = useState(null);
  const detailRef = useRef(null);
  const focusTask = useRef(null);

  const roles = useMemo(
    () => [...data.roles].sort((a, b) => a.name.localeCompare(b.name)),
    [data.roles],
  );
  const staffFor = useMemo(() => {
    const byId = new Map(data.workers.map((w) => [w.id, w]));
    const map = new Map();
    for (const a of data.assignments) {
      const w = byId.get(a.worker_id);
      if (!w || !w.active) continue;
      if (!map.has(a.role_id)) map.set(a.role_id, []);
      map.get(a.role_id).push(w);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [data.workers, data.assignments]);

  const counts = {
    all: roles.length,
    active: roles.filter((r) => r.active).length,
    inactive: roles.filter((r) => !r.active).length,
  };
  const q = query.trim().toLowerCase();
  const rows = roles.filter((r) => {
    if (status === "active" && !r.active) return false;
    if (status === "inactive" && r.active) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.tasks.some((t) => t.toLowerCase().includes(q));
  });
  const withoutDuties = roles.filter((r) => !r.tasks.length).length;

  const current =
    roles.find((r) => r.id === selected && rows.includes(r)) || rows[0] || null;

  // Focus a newly added responsibility field.
  useEffect(() => {
    if (focusTask.current === null) return;
    const el = detailRef.current?.querySelector(`[data-task="${focusTask.current}"]`);
    el?.focus();
    focusTask.current = null;
  });

  function choose(r) {
    if (draft && !window.confirm("Discard unsaved changes to this role?")) return;
    setDraft(null);
    setSelected(r.id);
    setMobileOpen(true);
  }
  function startEdit(r, { addTask = false } = {}) {
    const tasks = r.tasks.length ? [...r.tasks] : [""];
    if (addTask && r.tasks.length) tasks.push("");
    setDraft({ isNew: false, id: r.id, name: r.name, active: r.active, tasks });
    setMobileOpen(true);
    focusTask.current = addTask ? tasks.length - 1 : null;
  }
  function startNew() {
    if (draft && !window.confirm("Discard unsaved changes to this role?")) return;
    setDraft({ isNew: true, id: "", name: "", active: true, tasks: [""] });
    setMobileOpen(true);
    requestAnimationFrame(() => detailRef.current?.querySelector("#rd-name")?.focus());
  }
  function cancel() {
    if (draft?.isNew && !current) setMobileOpen(false);
    setDraft(null);
  }
  const setTask = (i, v) =>
    setDraft((d) => ({ ...d, tasks: d.tasks.map((t, j) => (j === i ? v : t)) }));
  const addTask = () => {
    setDraft((d) => (d.tasks.length >= MAX_TASKS ? d : { ...d, tasks: [...d.tasks, ""] }));
    focusTask.current = draft.tasks.length;
  };
  const removeTask = (i) =>
    setDraft((d) => {
      const tasks = d.tasks.filter((_, j) => j !== i);
      return { ...d, tasks: tasks.length ? tasks : [""] };
    });
  const moveTask = (i, dir) =>
    setDraft((d) => {
      const tasks = [...d.tasks];
      const j = i + dir;
      if (j < 0 || j >= tasks.length) return d;
      [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
      return { ...d, tasks };
    });

  function submit(e) {
    e.preventDefault();
    const name = draft.name.trim();
    const tasks = draft.tasks.map((t) => t.trim()).filter(Boolean);
    const id = draft.isNew ? roleIdFromName(name) : draft.id;
    if (!name) return onError("Enter a display name for this role.");
    if (draft.isNew && !/^[a-z_]{2,40}$/.test(id))
      return onError("Use at least two letters in the role name.");
    if (draft.isNew && data.roles.some((r) => r.id === id))
      return onError(`A role with this name already exists (ID “${id}”). Edit that role or choose a different name.`);
    if (new Set(tasks.map((t) => t.toLowerCase())).size !== tasks.length)
      return onError("Each responsibility must be different. Remove the duplicate and save again.");
    onSave({ id, name, active: draft.active, tasks }, () => {
      setDraft(null);
      setSelected(id);
    });
  }

  const draftCount = draft ? draft.tasks.filter((t) => t.trim()).length : 0;
  const showDetail = Boolean(draft) || Boolean(current);

  return (
    <>
      <div className="rd-head">
        <div>
          <h2>Roles & responsibilities</h2>
          <p className="sub">Each role’s checklist appears on the kiosk when staff clock in.</p>
        </div>
        <button type="button" className="primary" onClick={startNew} disabled={busy}>
          Add role
        </button>
      </div>

      <div className="rd-toolbar">
        <label className="sl-search">
          {Icon.search}
          <input
            type="search"
            aria-label="Search roles or duties"
            placeholder="Search roles or duties"
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
      </div>

      <div className={`rd${mobileOpen && showDetail ? " has-detail" : ""}`}>
        <div className="rd-list">
          <div className="rd-listhead" aria-hidden="true">
            <span>Role</span>
            <span>Duties · Staff</span>
          </div>
          {rows.length ? (
            <ul className="rd-items">
              {rows.map((r) => {
                const staff = staffFor.get(r.id)?.length || 0;
                const isCurrent = !draft?.isNew && current?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`rd-row${r.active ? "" : " inactive"}`}
                      aria-current={isCurrent}
                      onClick={() => choose(r)}
                    >
                      <span className="rd-rowtext">
                        <b>{r.name}</b>
                        <small>
                          {r.tasks.length ? dutyLabel(r.tasks.length) : <span className="rd-warn">No duties</span>}
                          {` · ${staff} staff`}
                          {!r.active && " · Inactive"}
                        </small>
                      </span>
                      {Icon.chev}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rd-none">{roles.length ? "No roles match this search." : "No roles yet. Add your first role."}</div>
          )}
          <div className="rd-listfoot">
            {roles.length} {roles.length === 1 ? "role" : "roles"}
            {withoutDuties > 0 && ` · ${withoutDuties} without duties`}
          </div>
        </div>

        <div className="rd-detail" ref={detailRef}>
          <button type="button" className="rd-back" onClick={() => (draft ? cancel() : setMobileOpen(false))}>
            {Icon.back}
            All roles
          </button>

          {draft ? (
            <form className="rd-form" onSubmit={submit}>
              <div className="rd-dhead">
                <div>
                  <h3>{draft.isNew ? "New role" : `Edit ${roles.find((r) => r.id === draft.id)?.name || draft.name}`}</h3>
                  <div className="rd-dmeta">
                    {draft.isNew ? (
                      <span>
                        Role ID <code>{roleIdFromName(draft.name) || "created from the name"}</code>
                      </span>
                    ) : (
                      <span>
                        Role ID <code>{draft.id}</code>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <label htmlFor="rd-name">
                Display name
                <input
                  id="rd-name"
                  type="text"
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>

              <div>
                <div className="rd-stitle">
                  <h4>Shift checklist</h4>
                  <span>
                    {draftCount} of {MAX_TASKS}
                  </span>
                </div>
                <ol className="rd-edit">
                  {draft.tasks.map((t, i) => (
                    <li key={i}>
                      <span className="rd-n" aria-hidden="true">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        data-task={i}
                        aria-label={`Responsibility ${i + 1}`}
                        placeholder="Describe one responsibility"
                        maxLength={MAX_TASK_LEN}
                        value={t}
                        onChange={(e) => setTask(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (i === draft.tasks.length - 1 && t.trim()) addTask();
                            else detailRef.current?.querySelector(`[data-task="${i + 1}"]`)?.focus();
                          }
                        }}
                      />
                      <button type="button" className="rd-ib" aria-label={`Move responsibility ${i + 1} up`} disabled={i === 0} onClick={() => moveTask(i, -1)}>
                        {Icon.up}
                      </button>
                      <button
                        type="button"
                        className="rd-ib"
                        aria-label={`Move responsibility ${i + 1} down`}
                        disabled={i === draft.tasks.length - 1}
                        onClick={() => moveTask(i, 1)}
                      >
                        {Icon.down}
                      </button>
                      <button type="button" className="rd-ib" aria-label={`Remove responsibility ${i + 1}`} onClick={() => removeTask(i)}>
                        {Icon.remove}
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" className="rd-add" onClick={addTask} disabled={draft.tasks.length >= MAX_TASKS}>
                  + Add responsibility
                </button>
              </div>

              <label className="rd-switch">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                />
                <span>
                  <b>Active</b>
                  <small>Staff can pick this role at the kiosk for new clock-ins and role switches.</small>
                </span>
              </label>

              <div className="rd-formacts">
                <button className="primary" disabled={busy}>
                  {draft.isNew ? "Create role" : "Save role"}
                </button>
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
              </div>
            </form>
          ) : current ? (
            <RoleDetail role={current} staff={staffFor.get(current.id) || []} busy={busy} onEdit={startEdit} />
          ) : (
            <div className="rd-none">Select a role to see its checklist.</div>
          )}
        </div>
      </div>
    </>
  );
}

function RoleDetail({ role, staff, busy, onEdit }) {
  return (
    <>
      <div className="rd-dhead">
        <div>
          <h3>{role.name}</h3>
          <div className="rd-dmeta">
            <span className={`rd-dot${role.active ? " ok" : ""}`}>{role.active ? "Active" : "Inactive"}</span>
            <span className="rd-sep" aria-hidden="true">
              ·
            </span>
            <span>{role.active ? "Available at the kiosk for new clock-ins" : "Hidden at the kiosk for new clock-ins"}</span>
          </div>
        </div>
        <div className="rd-dacts">
          <button type="button" disabled={busy} onClick={() => onEdit(role)}>
            Edit role
          </button>
        </div>
      </div>

      <div className="rd-section">
        <div className="rd-stitle">
          <h4>Shift checklist</h4>
          <span>
            {role.tasks.length} of {MAX_TASKS}
          </span>
        </div>
        {role.tasks.length ? (
          <ol className="rd-duties">
            {role.tasks.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        ) : (
          <div className="rd-empty">
            <p>No responsibilities yet. Staff who clock in as {role.name} won’t see a checklist.</p>
            <button type="button" disabled={busy} onClick={() => onEdit(role, { addTask: true })}>
              Add responsibilities
            </button>
          </div>
        )}
      </div>

      <div className="rd-section">
        <div className="rd-stitle">
          <h4>Assigned staff</h4>
          <span>{staff.length}</span>
        </div>
        {staff.length ? (
          <div className="rd-staff">
            {staff.map((w) => (
              <span key={w.id} className="rd-person">
                <i aria-hidden="true">{initials(w.name)}</i>
                {w.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="sub rd-nostaff">No active staff have this role. Assign it in Staff profiles.</p>
        )}
      </div>

      <p className="rd-note">
        Edits apply to future role starts. Checklists on shifts already in progress or completed keep their original
        responsibilities. Pay rates are set per person in Staff profiles.
      </p>
    </>
  );
}
