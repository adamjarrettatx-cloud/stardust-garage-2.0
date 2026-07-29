import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  compTypeLabel,
  entryStatusLabel,
  loadEventGrants,
  summarizeGrants,
} from '@/lib/guestlist-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Read-only per-partner breakdown of one event's guest list. Same data as the
// allocation panel on the event page (loadEventGrants), without the editing UI —
// the header links back to the event for that.

function formatEventDate(dateString) {
  if (!dateString) return 'Date TBC';
  return new Date(dateString + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function partnerState(grant) {
  if (grant.partner?.is_active) return { label: 'PARTNER ACTIVE', color: 'var(--auth-success)' };
  if (grant.partner) return { label: 'INVITE PENDING', color: 'var(--auth-warn)' };
  return { label: 'NO PARTNER LOGIN', color: 'var(--auth-warn)' };
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

function GrantCard({ grant }) {
  const state = partnerState(grant);
  const entries = grant.entries || [];
  const checkedIn = entries.filter((e) => e.status === 'checked_in').length;

  return (
    <div
      className="rounded-[12px] border p-5 mb-3"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
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
        </div>
        <span
          className="text-[10px] font-semibold tracking-[0.14em]"
          style={{ color: state.color }}
        >
          {state.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="TOTAL" value={grant.total_slots} />
        <Stat label="FREE USED" value={`${grant.usage.free}/${grant.free_slots}`} />
        <Stat label="DISCOUNTED USED" value={`${grant.usage.discount}/${grant.discount_slots}`} />
        <Stat label="CHECKED IN" value={checkedIn} />
      </div>

      {grant.discount_detail && (
        <div className="text-[12px] mt-4" style={{ color: 'var(--auth-violet-strong)' }}>
          Discount: {grant.discount_detail}
        </div>
      )}
      {grant.notes && (
        <div className="text-[12px] mt-1" style={{ color: 'var(--auth-muted)' }}>
          {grant.notes}
        </div>
      )}

      {entries.length > 0 && (
        <ul
          className="mt-4 pt-4 border-t space-y-1"
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function EventGuestListPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const admin = createAdminClient();

  const { data: event } = await admin
    .from('events')
    .select('id, title, event_date')
    .eq('id', id)
    .maybeSingle();
  if (!event) notFound();

  const { grants, error } = await loadEventGrants(admin, id);
  if (error) console.error('[bananas.guest-list.event]', error);

  const rows = grants || [];
  const totals = summarizeGrants(rows);

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas/guest-list"
        backLabel="← BACK TO GUEST LIST"
        title={event.title || 'Untitled event'}
        description={formatEventDate(event.event_date)}
        titleClassName="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      >
        <Link
          href={`/bananas/events/${event.id}`}
          className="auth-theme-border-button px-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
          style={{ color: 'var(--auth-accent)' }}
        >
          EDIT ALLOCATION
        </Link>
      </AuthenticatedPageHeader>

      {error && (
        <p className="text-[13px] mb-8" style={{ color: 'var(--auth-danger)' }}>
          Could not load this event&apos;s grants. Try again in a moment.
        </p>
      )}

      <div
        className="rounded-[12px] border p-5 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-4"
        style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
      >
        <Stat label="PARTNERS" value={totals.partners} />
        <Stat
          label="SLOTS ALLOCATED"
          value={totals.free_slots + totals.discount_slots}
          hint={`${totals.free_slots} free · ${totals.discount_slots} discounted`}
        />
        <Stat
          label="USED"
          value={totals.used}
          hint={`${totals.used_free} free · ${totals.used_discount} discounted`}
        />
        <Stat label="CHECKED IN" value={totals.checked_in} />
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-[12px] border p-8 text-center text-[13px]"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)', color: 'var(--auth-muted)' }}
        >
          No guest list grants for this event yet.
        </div>
      ) : (
        rows.map((grant) => <GrantCard key={grant.id} grant={grant} />)
      )}
    </main>
  );
}
