import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import CapacityWorkspace from './CapacityWorkspace';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Capacity · Stardust Garage', robots: { index: false, follow: false } };

// Single admin home for capacity: live count + session controls, door-station
// launchers, live/historical analytics, device links and the audit log.
// ?tab=tonight|history|devices|log, ?event=<id> opens Event history on that event.
export default async function CapacityPage({ searchParams }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);
  const params = await searchParams;
  const initialEvent = typeof params?.event === 'string' ? params.event : null;
  const initialTab = typeof params?.tab === 'string' ? params.tab : initialEvent ? 'history' : 'tonight';
  return <CapacityWorkspace initialTab={initialTab} initialEvent={initialEvent} />;
}
