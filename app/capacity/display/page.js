import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import DisplayClient from './DisplayClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Capacity Display',
  other: { 'theme-color': '#0a0a0a' },
};

export default async function DisplayPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/team/login');
  return <DisplayClient />;
}
