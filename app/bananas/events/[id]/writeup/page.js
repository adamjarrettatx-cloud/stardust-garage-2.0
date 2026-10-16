import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import { loadEventWriteup } from '@/lib/event-writeup-data';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import WriteupClient from './WriteupClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

function formatDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default async function EventWriteupPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const admin = createAdminClient();
  const data = await loadEventWriteup(admin, id);
  if (!data) notFound();

  const dateLabel = formatDate(data.event.event_date);

  return (
    <div className="max-w-[980px]">
      <AuthenticatedPageHeader
        backHref={`/bananas/events/${id}`}
        backLabel="← BACK TO EVENT"
        title="Financial Write-Up"
        description={[data.event.title, dateLabel].filter(Boolean).join(' · ')}
        eyebrow="ADMIN ONLY"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
      />
      <WriteupClient eventId={id} initial={data} />
    </div>
  );
}
