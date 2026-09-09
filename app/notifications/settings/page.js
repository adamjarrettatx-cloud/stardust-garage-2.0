import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import SettingsClient from './SettingsClient';

export const metadata = { title: 'Notification Settings \u00b7 Stardust Garage' };
export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/');
  return <SettingsClient />;
}
