import { redirect } from 'next/navigation';
import { stationContext } from '@/lib/station-session';
import { stationHome } from '@/lib/station-policy';
import AvailabilityCalendar from './AvailabilityCalendar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar Availability | Stardust Garage', robots: { index: false, follow: false } };
export default async function AvailabilityPage() {
  const { station } = await stationContext();
  if (!station) redirect('/staff/login');
  if (station.role !== 'calendar_availability') redirect(stationHome(station.role));
  return <AvailabilityCalendar />;
}
