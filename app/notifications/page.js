import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import NotificationsClient from './NotificationsClient';

export const metadata = { title: 'Notifications \u00b7 Stardust Garage' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/');
  return <NotificationsClient />;
}
