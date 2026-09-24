import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';

export const revalidate = 0;

// Keep old bookmarks working, but there is now one canonical account profile.
export default async function PartnerProfilePage() {
  const { unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');
  redirect('/account/profile');
}
