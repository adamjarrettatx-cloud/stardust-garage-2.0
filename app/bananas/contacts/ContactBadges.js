import { contactStatusLabel, contactTypeLabel } from '@/lib/contact-helpers';

// do_not_book has to be impossible to miss — it's the whole point of tracking
// status on a contact.
const STATUS_STYLES = {
  active: {
    background: 'var(--auth-card-bg-alt)',
    color: 'var(--auth-text)',
    border: '1px solid var(--auth-card-border-strong)',
  },
  inactive: {
    background: 'var(--auth-card-bg-alt)',
    color: 'var(--auth-muted)',
    border: '1px solid var(--auth-card-border)',
  },
  do_not_book: {
    background: 'rgba(239,68,68,0.12)',
    color: '#ff8080',
    border: '1px solid rgba(239,68,68,0.4)',
  },
};

export function ContactStatusBadge({ status }) {
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
      style={STATUS_STYLES[status] || STATUS_STYLES.active}
    >
      {contactStatusLabel(status).toUpperCase()}
    </span>
  );
}

export function ContactTypeBadges({ types }) {
  if (!types || types.length === 0) return null;
  return (
    <>
      {types.map((t) => (
        <span
          key={t}
          className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
          style={{
            background: 'var(--auth-card-bg-alt)',
            color: 'var(--auth-text)',
            border: '1px solid var(--auth-card-border-strong)',
          }}
        >
          {contactTypeLabel(t).toUpperCase()}
        </span>
      ))}
    </>
  );
}
