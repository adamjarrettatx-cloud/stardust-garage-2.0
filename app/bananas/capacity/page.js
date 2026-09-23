import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import CapacityAnalyticsClient from './CapacityAnalyticsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Event Capacity · Stardust Garage', robots: { index: false, follow: false } };

export default async function CapacityAnalyticsPage({ searchParams }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);
  const params = await searchParams;
  return <CapacityAnalyticsClient initialEvent={typeof params?.event === 'string' ? params.event : null} />;
}
