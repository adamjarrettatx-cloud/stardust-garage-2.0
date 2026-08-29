'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import {
  compTypeLabel,
  entryStatusLabel,
  grantNotificationNotice,
  summarizeGrants,
  validateGrantSlots,
} from '@/lib/guestlist-helpers';
import ContactSelect from '../../components/ContactSelect';

const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-2';
const labelStyle = { color: 'var(--auth-muted)' };
const inputClass =
  'w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
const inputStyle = {
  background: 'var(--auth-input-bg)',
  borderColor: 'var(--auth-input-border)',
  color: 'var(--auth-input-text)',
};

const EMPTY_FORM = {
  total_slots: '',
  free_slots: '',
  discount_slots: '',
  discount_detail: '',
  notes: '',
};

function Badge({ children, color, bg, border }) {
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
      style={{ color, background: bg, border: `1px solid ${border}` }}
    >
      {children}
    </span>
  );
}

function PartnerState({ grant }) {
  if (grant.partner?.is_active) {
    return (
      <Badge
        color="var(--auth-success)"
        bg="var(--auth-success-bg)"
        border="var(--auth-success-border)"
      >
        PARTNER ACTIVE
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge color="var(--auth-warn)" bg="var(--auth-warn-bg)" border="var(--auth-warn-border)">
        {grant.partner ? 'INVITE PENDING' : 'NO PORTAL LOGIN'}
      </Badge>
      <span className="text-[11px]" style={{ color: 'var(--auth-warn-strong)' }}>
        {grant.partner
          ? 'They can’t add guests until they finish activating.'
          : 'They can’t see this grant until they’re invited and activate.'}{' '}
        <Link href={`/bananas/contacts/${grant.contact_id}`} className="underline">
          Open contact
        </Link>
      </span>
    </div>
  );
}

// Slot numbers + discount detail + notes. Shared by "grant slots" and "edit
// grant" so both enforce free + discount <= total the same way the DB CHECK
// constraint and the API route do. `usage` is only passed when editing.
function GrantForm({ form, setForm, usage = null, busy, error, onSubmit, onCancel, submitLabel }) {
  const showDiscountDetail = Number(form.discount_slots) > 0;
  const field = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['total_slots', 'TOTAL', null],
          ['free_slots', 'FREE', usage?.free],
          ['discount_slots', 'DISCOUNTED', usage?.discount],
        ].map(([key, label, used]) => (
          <div key={key}>
            <label className={labelClass} style={labelStyle}>
              {label}
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={form[key]}
              onChange={field(key)}
              required
              className={inputClass}
              style={inputStyle}
            />
            {used != null && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--auth-muted)' }}>
                {used} used
              </p>
            )}
          </div>
        ))}
      </div>

      {showDiscountDetail && (
        <div>
          <label className={labelClass} style={labelStyle}>
            DISCOUNT DETAIL
          </label>
          <input
            type="text"
            value={form.discount_detail}
            onChange={field('discount_detail')}
            placeholder="e.g. 50% off door, $10 flat before 11"
            className={inputClass}
            style={inputStyle}
          />
          <p className="text-[11px] mt-1" style={{ color: 'var(--auth-muted)' }}>
            Door staff read this verbatim. Cleared if discounted slots go back to 0.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass} style={labelStyle}>
          NOTES (INTERNAL)
        </label>
        <textarea
          value={form.notes}
          onChange={field('notes')}
          rows={2}
          className={inputClass + ' resize-y'}
          style={inputStyle}
        />
      </div>

      {error && (
        <p className="text-[13px]" style={{ color: 'var(--auth-danger)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-6 py-3 rounded-full text-[11px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40"
          style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
        >
          {busy ? 'SAVING…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-6 py-3 rounded-full text-[11px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}

// One number per column, matching the roll-up the read-only page used to show
// above the grants. It's rendered from the panel's own live grant list, so it
// can't drift out of step with the rows underneath after a grant is edited -
// which is exactly what a server-rendered strip above a client panel would do.
function Totals({ grants }) {
  const totals = summarizeGrants(grants);
  const cells = [
    ['HOSTS', totals.partners, null],
    [
      'SLOTS ALLOCATED',
      totals.free_slots + totals.discount_slots,
      `${totals.free_slots} free \u00b7 ${totals.discount_slots} discounted`,
    ],
    ['USED', totals.used, `${totals.used_free} free \u00b7 ${totals.used_discount} discounted`],
    ['CHECKED IN', totals.checked_in, null],
  ];

  return (
    <div
      className="rounded-[10px] border p-4 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-4"
      style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
    >
      {cells.map(([label, value, hint]) => (
        <div key={label}>
          <div
            className="text-[10px] font-semibold tracking-[0.14em] mb-1"
            style={{ color: 'var(--auth-muted)' }}
          >
            {label}
          </div>
          <div className="text-[18px] font-bold" style={{ color: 'var(--auth-text-strong)' }}>
            {value}
          </div>
          {hint && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>
              {hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Per-event guest list allocation. Every write goes through
// /api/admin/events/:id/guestlist so validation and the guestlist_audit_log row
// happen server-side; each response hands back the refreshed grant list, so this
// component never has to patch its own state guess into place.
export default function GuestListPanel({ eventId }) {
  const [grants, setGrants] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [addForm, setAddForm] = useState(null);
  const [addContactId, setAddContactId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState({});
  // Guest names show by default: this panel is the whole guest list screen, so
  // hiding the names behind a toggle would bury the thing the page is named for.
  // The map only records grants the admin has deliberately collapsed.
  const [collapsed, setCollapsed] = useState({});
  // Whether the last save emailed the partner. Worth stating outright: the admin
  // otherwise has no way to know an email went out, or why one didn't.
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/guestlist`);
      setGrants(res.grants || []);
      setLoadError('');
    } catch (err) {
      setLoadError(err?.message || 'Could not load guest list grants');
    }
  }, [eventId]);

  // A write answers with the refreshed list. It comes back null if the write
  // landed but the re-read didn't, so fall back to a plain reload rather than
  // rendering an empty panel over a grant that does exist.
  const applyGrants = useCallback(
    async (res) => {
      if (res?.grants) setGrants(res.grants);
      else await load();
    },
    [load]
  );

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setAddContactId(null);
    setAddForm({ ...EMPTY_FORM });
    setEditing(null);
    setFormError('');
  };

  const openEdit = (grant) => {
    setEditing({
      id: grant.id,
      usage: grant.usage,
      form: {
        total_slots: String(grant.total_slots),
        free_slots: String(grant.free_slots),
        discount_slots: String(grant.discount_slots),
        discount_detail: grant.discount_detail || '',
        notes: grant.notes || '',
      },
    });
    setAddForm(null);
    setFormError('');
  };

  async function submitForm(url, method, form, usage) {
    const { valid, error } = validateGrantSlots(form, usage);
    if (!valid) {
      setFormError(error);
      return;
    }

    setBusy(true);
    setFormError('');
    setNotice(null);
    try {
      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await applyGrants(res);
      setNotice({
        text: grantNotificationNotice(res?.notification),
        sent: Boolean(res?.notification?.sent),
      });
      setAddForm(null);
      setEditing(null);
    } catch (err) {
      setFormError(err?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const handleAdd = (e) => {
    e.preventDefault();
    if (!addContactId) {
      setFormError('Select a contact to grant slots to.');
      return;
    }
    submitForm(`/api/admin/events/${eventId}/guestlist`, 'POST', {
      ...addForm,
      contactId: addContactId,
    });
  };

  const handleEdit = (e) => {
    e.preventDefault();
    submitForm(
      `/api/admin/events/${eventId}/guestlist/${editing.id}`,
      'PATCH',
      editing.form,
      editing.usage
    );
  };

  const handleRevoke = async (grant) => {
    const name = grant.contact?.display_name || 'this contact';
    if (!window.confirm(`Revoke the guest list grant for ${name}? This cannot be undone.`)) return;

    setRowError((prev) => ({ ...prev, [grant.id]: '' }));
    setNotice(null);
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/guestlist/${grant.id}`, {
        method: 'DELETE',
      });
      await applyGrants(res);
    } catch (err) {
      setRowError((prev) => ({ ...prev, [grant.id]: err?.message || 'Could not revoke the grant' }));
    } finally {
      setBusy(false);
    }
  };

  const grantedContactIds = (grants || []).map((g) => g.contact_id);

  return (
    <section
      className="rounded-[12px] border p-5"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2
          className="text-[12px] font-semibold tracking-[0.14em]"
          style={{ color: 'var(--auth-muted)' }}
        >
          GUEST LIST ALLOCATION
        </h2>
        {!addForm && (
          <button
            type="button"
            onClick={openAdd}
            className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            GRANT SLOTS
          </button>
        )}
      </div>
      <p className="text-[12px] mb-5" style={{ color: 'var(--auth-muted)' }}>
        Free and discounted door spots a partner can spend on named guests for this event.
      </p>

      {grants?.length > 0 && <Totals grants={grants} />}

      {addForm && (
        <div
          className="rounded-[10px] border p-4 mb-5"
          style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
        >
          <div className="mb-4">
            <label className={labelClass} style={labelStyle}>
              CONTACT
            </label>
            <ContactSelect
              value={addContactId}
              onChange={setAddContactId}
              excludeIds={grantedContactIds}
              hint="Contacts already holding a grant for this event are hidden — edit theirs instead."
            />
          </div>
          <GrantForm
            form={addForm}
            setForm={setAddForm}
            busy={busy}
            error={formError}
            onSubmit={handleAdd}
            onCancel={() => setAddForm(null)}
            submitLabel="GRANT SLOTS"
          />
        </div>
      )}

      {notice?.text && (
        <p
          className="text-[12px] mb-4"
          style={{ color: notice.sent ? 'var(--auth-success)' : 'var(--auth-warn-strong)' }}
        >
          {notice.text}
        </p>
      )}

      {loadError && (
        <p className="text-[13px]" style={{ color: 'var(--auth-danger)' }}>
          {loadError}
        </p>
      )}

      {!loadError && grants === null && (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          Loading grants…
        </p>
      )}

      {grants?.length === 0 && (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No guest list grants for this event yet.
        </p>
      )}

      <div className="space-y-3">
        {(grants || []).map((grant) => {
          const isEditing = editing?.id === grant.id;
          const entries = grant.entries || [];
          return (
            <div
              key={grant.id}
              className="rounded-[10px] border p-4"
              style={{
                background: 'var(--auth-card-bg-alt)',
                borderColor: 'var(--auth-card-border)',
              }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <Link
                    href={`/bananas/contacts/${grant.contact_id}`}
                    className="text-[15px] font-bold hover:underline"
                    style={{ color: 'var(--auth-text-strong)' }}
                  >
                    {grant.contact?.display_name || 'Unknown contact'}
                  </Link>
                  {grant.contact?.company && (
                    <span className="text-[12px] ml-2" style={{ color: 'var(--auth-muted)' }}>
                      {grant.contact.company}
                    </span>
                  )}
                  <div className="text-[13px] mt-1" style={{ color: 'var(--auth-text)' }}>
                    {grant.total_slots} total ·{' '}
                    <span style={{ color: 'var(--auth-muted-strong)' }}>
                      {grant.usage.free}/{grant.free_slots} free used
                    </span>{' '}
                    ·{' '}
                    <span style={{ color: 'var(--auth-muted-strong)' }}>
                      {grant.usage.discount}/{grant.discount_slots} discounted used
                    </span>
                  </div>
                  {grant.discount_detail && (
                    <div className="text-[12px] mt-1" style={{ color: 'var(--auth-violet-strong)' }}>
                      Discount: {grant.discount_detail}
                    </div>
                  )}
                  {grant.notes && (
                    <div className="text-[12px] mt-1" style={{ color: 'var(--auth-muted)' }}>
                      {grant.notes}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditing(null) : openEdit(grant))}
                      className="px-4 py-2 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
                      style={{
                        borderColor: 'var(--auth-card-border-strong)',
                        color: 'var(--auth-text)',
                      }}
                    >
                      {isEditing ? 'CLOSE' : 'EDIT'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(grant)}
                      disabled={busy}
                      className="px-4 py-2 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors disabled:opacity-40"
                      style={{
                        borderColor: 'var(--auth-danger-border)',
                        color: 'var(--auth-danger)',
                      }}
                    >
                      REVOKE
                    </button>
                  </div>
                  {entries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCollapsed((prev) => ({ ...prev, [grant.id]: !prev[grant.id] }))}
                      className="text-[11px] underline"
                      style={{ color: 'var(--auth-muted)' }}
                    >
                      {collapsed[grant.id] ? 'Show' : 'Hide'} {entries.length} guest
                      {entries.length === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <PartnerState grant={grant} />
              </div>

              {rowError[grant.id] && (
                <p className="text-[12px] mt-3" style={{ color: 'var(--auth-danger)' }}>
                  {rowError[grant.id]}
                </p>
              )}

              {!collapsed[grant.id] && entries.length > 0 && (
                <ul
                  className="mt-3 pt-3 border-t space-y-1"
                  style={{ borderColor: 'var(--auth-row-border)' }}
                >
                  {entries.map((entry) => (
                    <li key={entry.id} className="text-[12px]" style={{ color: 'var(--auth-text)' }}>
                      {entry.guest_name}
                      <span style={{ color: 'var(--auth-muted)' }}>
                        {' · '}
                        {compTypeLabel(entry.comp_type)}
                        {' · '}
                        {entryStatusLabel(entry.status)}
                      </span>
                      {entry.signature_profile_id && (
                        <>
                          {' · '}
                          <a
                            href={`/api/admin/guest-signature/${entry.signature_profile_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold hover:underline"
                            style={{ color: 'var(--auth-accent)' }}
                          >
                            SIGNATURE ON FILE
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {isEditing && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--auth-row-border)' }}>
                  <GrantForm
                    form={editing.form}
                    setForm={(form) => setEditing({ ...editing, form })}
                    usage={grant.usage}
                    busy={busy}
                    error={formError}
                    onSubmit={handleEdit}
                    onCancel={() => setEditing(null)}
                    submitLabel="SAVE CHANGES"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
