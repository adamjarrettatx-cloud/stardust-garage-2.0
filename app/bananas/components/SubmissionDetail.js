// Shared "profile page" building blocks for the admin submission detail
// pages (venue inquiries, micro-parties, collaborations, applications).
// Replaces the old pattern of one full-width bordered row per field (lots
// of scrolling, everything visually disconnected) with:
//   - a compact profile header that surfaces name/status/contact right away
//   - a 2-column grid for short fields so more fits above the fold
//   - long-form fields (notes, vision, etc.) still get full width

export function initials(name) {
  if (!name) return '?';
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

export function Avatar({ name, photoUrl, size = 64 }) {
  const dim = `${size}px`;
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        className="flex-shrink-0 object-cover"
        style={{ width: dim, height: dim, borderRadius: '16px', border: '1px solid var(--auth-card-border-strong)' }}
      />
    );
  }
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center font-bold"
      style={{
        width: dim,
        height: dim,
        fontSize: `${Math.round(size * 0.32)}px`,
        borderRadius: '16px',
        background: 'var(--auth-card-bg-alt)',
        border: '1px solid var(--auth-card-border-strong)',
        color: 'var(--auth-muted)',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {initials(name)}
    </div>
  );
}

export function Pill({ children }) {
  if (!children) return null;
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
      style={{
        background: 'var(--auth-card-bg-alt)',
        color: 'var(--auth-text)',
        border: '1px solid var(--auth-card-border-strong)',
      }}
    >
      {children}
    </span>
  );
}

// The whole "profile card" at the top: avatar, name, badges, submitted
// date, and (crucially) the contact row + status actions right there so
// the admin doesn't have to scroll to reach them.
export function ProfileHeader({ name, subtitle, photoUrl, badges, submittedLabel, contactRow, actions }) {
  return (
    <div
      className="rounded-[16px] border p-6 mb-5"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex items-start gap-5 flex-wrap">
        <Avatar name={name} photoUrl={photoUrl} />
        <div className="flex-1 min-w-[220px]">
          {badges && badges.length > 0 && (
            <div className="flex items-center gap-2 mb-2 flex-wrap">{badges}</div>
          )}
          <h1
            className="text-[26px] font-extrabold -tracking-[0.02em] leading-[1.15]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {name}
          </h1>
          {subtitle && (
            <p className="text-[14px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>
              {subtitle}
            </p>
          )}
          {submittedLabel && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--auth-faint)' }}>
              {submittedLabel}
            </p>
          )}
        </div>
      </div>

      {contactRow && (
        <div
          className="mt-4 pt-4 flex flex-wrap items-center gap-x-6 gap-y-3"
          style={{ borderTop: '1px solid var(--auth-row-border)' }}
        >
          {contactRow}
        </div>
      )}

      {actions && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--auth-row-border)' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

// One "email" or "phone" style contact chip for the profile header's
// contact row — icon-free, just a compact labeled link plus its quick
// action (Reply / WhatsApp) alongside it.
export function ContactChip({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold tracking-[0.12em]" style={{ color: 'var(--auth-faint)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function DetailSection({ title, children, className = '' }) {
  return (
    <section
      className={`rounded-[14px] p-6 border mb-4 ${className}`}
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <h2
        className="text-[11px] font-bold tracking-[0.16em] mb-4"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--auth-muted-strong)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// 2-column grid on larger screens for compact fields; pass `full` on a
// DetailItem to make it span both columns (for longer free-text answers).
export function DetailGrid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">{children}</div>;
}

export function DetailItem({ label, children, full = false }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <div className="text-[10px] font-semibold tracking-[0.12em] mb-1" style={{ color: 'var(--auth-muted)' }}>
        {label}
      </div>
      <div className="text-[14px] leading-[1.55]" style={{ whiteSpace: 'pre-wrap' }}>
        {children || <span style={{ color: 'var(--auth-faint)' }}>—</span>}
      </div>
    </div>
  );
}
