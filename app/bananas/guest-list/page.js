import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadGuestlistSummary } from '@/lib/guestlist-helpers';
import { getTodayInAustin } from '@/lib/studio-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Guest list activity across every event, so staff can see where the door is
// filling up without opening each event in turn. Read-only: editing an
// allocation stays on the event's own page (GuestListPanel).

function formatEventDate(dateString) {
  if (!dateString) return 'Date TBC';
  return new Date(dateString + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function Stat({ label, value, hint = null }) {
  return (
    <div>
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
  );
}

function EventRow({ row }) {
  const allocated = row.free_slots + row.discount_slots;
  return (
    <Link
      href={`/bananas/guest-list/${row.event.id}`}
      className="block rounded-[12px] border p-5 mb-3 transition-colors hover:border-white/20"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4">
        <span className="text-[16px] font-bold" style={{ color: 'var(--auth-text-strong)' }}>
          {row.event.title || 'Untitled event'}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
          {formatEventDate(row.event.event_date)}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="HOSTS" value={row.partners} />
        <Stat
          label="SLOTS ALLOCATED"
          value={allocated}
          hint={`${row.free_slots} free · ${row.discount_slots} discounted`}
        />
        <Stat
          label="USED"
          value={row.used}
          hint={`${row.used_free} free · ${row.used_discount} discounted`}
        />
        <Stat label="CHECKED IN" value={row.checked_in} />
      </div>
    </Link>
  );
}

function Section({ label, rows, emptyText }) {
  return (
    <div className="mb-12">
      <div
        className="text-[11px] font-semibold tracking-[0.18em] mb-4"
        style={{ color: 'var(--auth-muted)' }}
      >
        {label} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <div
          className="rounded-[12px] border p-8 text-center text-[13px]"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)', color: 'var(--auth-muted)' }}
        >
          {emptyText}
        </div>
      ) : (
        rows.map((row) => <EventRow key={row.event.id} row={row} />)
      )}
    </div>
  );
}

export default async function GuestListSummaryPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  // Access gated above; read with the service-role client like the other admin
  // server components do (never bundled to the browser).
  const admin = createAdminClient();
  const { events, error } = await loadGuestlistSummary(admin);

  if (error) {
    console.error('[bananas.guest-list.summary]', error);
  }

  const today = getTodayInAustin();
  const rows = events || [];
  // summarizeEventGuestlists sorts newest first, which is what "recent" wants
  // and the reverse of what reads naturally for what's coming up.
  const upcoming = rows.filter((r) => (r.event.event_date || '') >= today).reverse();
  const past = rows.filter((r) => (r.event.event_date || '') < today);

  return (
    <>
      <AuthenticatedPageHeader
        title="Guest List"
        description="Every event with a guest list allocation. Slots are what your hosts may spend; used counts names they've added (no-shows free their slot back up). Open an event to see the per-host breakdown."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      {error && (
        <p className="text-[13px] mb-8" style={{ color: 'var(--auth-danger)' }}>
          Could not load guest list activity. Try again in a moment.
        </p>
      )}

      <Section
        label="UPCOMING"
        rows={upcoming}
        emptyText="No upcoming event has guest list grants yet. Grant slots from an event's detail page."
      />
      {past.length > 0 && <Section label="PAST" rows={past} emptyText="" />}
    </>
  );
}
