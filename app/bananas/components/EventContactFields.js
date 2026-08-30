'use client';

import ContactSelect from './ContactSelect';

// Contact types allowed to appear in an event's Event Organizer slot. The list
// is intentionally broader than just event_organizer so a collective, promoter
// or venue renter can still be picked — EventForm tags them event_organizer on
// save, so the profile always matches the role by the time a contract is drawn.
const ORGANIZER_CONTACT_TYPES = [
  'event_organizer',
  'collective',
  'promoter',
  'venue_renter',
  'artist',
  'dj',
  'performer',
  'resident',
  'vendor',
  'other',
];

// The "who is the organizer of this event" block shared by both event-creation
// flows (EventForm.js and TtEventCreator.js) so the rule looks and behaves
// identically in each: every event either has an Event Organizer — the outside
// counterparty who signs the contract — or is explicitly flagged SDG-only.
//
// Client-side blocking lives in each form's handleSubmit; the server route and
// the events_contact_required_unless_sdg_only CHECK constraint are the backstops.
export default function EventContactFields({ isSdgOnly, onSdgOnlyChange, contactId, onContactIdChange }) {
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };

  return (
    <div>
      <label className={labelClass} style={labelStyle}>WHO IS ORGANIZING THIS EVENT?</label>
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
            Event Organizer
          </div>
          <div className="text-[12px]" style={{ color: !isSdgOnly ? 'var(--auth-faint)' : 'var(--auth-muted)' }}>
            An outside partner, collective, promoter or renter
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
            EVENT ORGANIZER <span style={{ color: '#ff8080' }}>*</span>
          </label>
          <ContactSelect
            value={contactId}
            onChange={onContactIdChange}
            required
            contactTypeIn={ORGANIZER_CONTACT_TYPES}
            hint="The outside counterparty responsible for this event — usually who signs the event agreement. Whoever you pick will be tagged Event Organizer on save."
          />
        </div>
      )}
    </div>
  );
}
