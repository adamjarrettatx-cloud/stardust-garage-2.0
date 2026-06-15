import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import FrontDoorClient from './FrontDoorClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Front Door · Capacity',
  other: { 'theme-color': '#0a0a0a' },
};

export default async function FrontDoorPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/team/login');
  return <FrontDoorClient />;
}
