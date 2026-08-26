'use client';

import ContactSelect from './ContactSelect';

// The "who is this event with" block shared by both event-creation flows
// (EventForm.js and TtEventCreator.js) so the rule looks and behaves identically
// in each: every event either belongs to an outside partner — and must name the
// Contact — or is explicitly flagged SDG-only.
//
// Client-side blocking lives in each form's handleSubmit; the server route and
// the events_contact_required_unless_sdg_only CHECK constraint are the backstops.
export default function EventContactFields({ isSdgOnly, onSdgOnlyChange, contactId, onContactIdChange }) {
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };

  return (
    <div>
      <label className={labelClass} style={labelStyle}>WHO IS THIS EVENT WITH?</label>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSdgOnlyChange(false)}
          className="py-4 px-5 rounded-[10px] border text-left transition-all"
          style={{
            background: !isSdgOnly ? 'var(--auth-text-strong)' : 'var(--auth-card-bg)',
            borderColor: !isSdgOnly ? 'var(--auth-text-strong)' : 'var(--auth-card-border)',
            color: !isSdgOnly ? 'var(--auth-strong-surface-text)' : 'var(--auth-text)',
          }}
        >
          <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Outside Partner
          </div>
          <div className="text-[12px]" style={{ color: !isSdgOnly ? 'var(--auth-faint)' : 'var(--auth-muted)' }}>
            Organizer, collective, renter or vendor
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSdgOnlyChange(true)}
          className="py-4 px-5 rounded-[10px] border text-left transition-all"
          style={{
            background: isSdgOnly ? 'var(--auth-accent)' : 'var(--auth-card-bg)',
            borderColor: isSdgOnly ? 'var(--auth-accent)' : 'var(--auth-card-border)',
            color: isSdgOnly ? 'var(--auth-accent-text)' : 'var(--auth-text)',
          }}
        >
          <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            SDG Only
          </div>
          <div className="text-[12px]" style={{ color: isSdgOnly ? 'var(--auth-accent-text)' : 'var(--auth-muted)' }}>
            Fully internal · no contact needed
          </div>
        </button>
      </div>

      {!isSdgOnly && (
        <div className="mt-4">
          <label className={labelClass} style={labelStyle}>
            CONTACT <span style={{ color: '#ff8080' }}>*</span>
          </label>
          <ContactSelect
            value={contactId}
            onChange={onContactIdChange}
            required
            hint="Required for any event with an outside organizer, collective, promoter, or venue renter."
          />
        </div>
      )}
    </div>
  );
}
