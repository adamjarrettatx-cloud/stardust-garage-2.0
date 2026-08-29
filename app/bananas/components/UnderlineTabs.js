'use client';

// ---------------------------------------------------------------------------
// UnderlineTabs
// ---------------------------------------------------------------------------
// One tab strip for every in-page filter in the admin panel. Replaces three
// separate pill implementations that had drifted apart: SubmissionTabs (five
// list pages, per-status colours), the local TabBar in PayRequestsClient
// (accent-filled), and the inline type filter in ContactsList (inverted
// solid). All three did the same job and looked like three different products.
//
// Why underline rather than pills: these tabs sit inside a page that is itself
// inside the admin sidebar, so the screen already has one strong set of filled,
// rounded nav items. A second row of filled pills competed with it for the eye
// and read as primary navigation rather than a filter on the list below.
// An underline is quieter, and it points down at the content it governs.
//
// Colour still carries the status meaning it did before, moved from a filled
// background to the underline and the count chip. It deliberately does NOT move
// to the label text: the status palette (#ffb84d, #4ade80, #38bdf8 …) is tuned
// for dark mode and was only ever used as a pill fill behind near-black text.
// Recoloured label text would sit at roughly 1.7:1 on the light page
// background — unreadable, and well under the 4.5:1 body minimum. The label
// takes the normal strong text colour in both themes; the colour lives on the
// 2px underline and the chip, where it is a large block against the page and
// clears 3:1.
//
// Selection never depends on colour alone — the active tab is also bolder and
// the only one underlined.
export default function UnderlineTabs({
  tabs,
  active,
  onChange,
  ariaLabel = 'Filter',
  className = '',
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // The bottom rule runs the full width so the active underline reads as a
      // break in a continuous line rather than a floating dash. overflow-x
      // keeps six status tabs usable on a narrow window instead of wrapping
      // into a second row that would sit below the rule.
      className={`flex items-stretch gap-7 mb-8 overflow-x-auto border-b ${className}`}
      style={{ borderColor: 'var(--auth-card-border)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        // Underline/chip accent. Contacts and Artist Pay filter by category
        // rather than status, so they define no colour and fall back to the
        // theme accent.
        const accent = tab.color || 'var(--auth-accent)';
        const count = tab.count;
        const hasCount = typeof count === 'number';

        return (
          <button
            key={tab.id === '' ? '__all' : tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            // -mb-px pulls the 2px underline over the container's 1px rule so
            // they occupy the same line instead of stacking.
            className="group flex items-center gap-2 flex-shrink-0 whitespace-nowrap pb-3 -mb-px text-[14px] transition-colors"
            style={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: isActive ? 700 : 500,
              letterSpacing: '-0.005em',
              color: isActive ? 'var(--auth-text-strong)' : 'var(--auth-muted)',
              borderBottom: `2px solid ${isActive ? accent : 'transparent'}`,
              background: 'none',
              cursor: 'pointer',
            }}
          >
            {tab.label}
            {hasCount && (
              <span
                className="inline-flex items-center justify-center min-w-[20px] h-[19px] px-1.5 rounded-full text-[11px] font-bold leading-none tabular-nums"
                style={{
                  background: isActive ? accent : 'var(--auth-hover-bg)',
                  color: isActive ? '#0a0a0a' : 'var(--auth-muted)',
                }}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
