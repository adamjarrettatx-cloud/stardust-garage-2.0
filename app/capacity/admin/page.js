import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-helpers';
import AdminCapacityClient from './AdminCapacityClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Capacity Setup' };

export default async function CapacityAdminPage() {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) redirect('/bananas/login');
  return <AdminCapacityClient />;
}
