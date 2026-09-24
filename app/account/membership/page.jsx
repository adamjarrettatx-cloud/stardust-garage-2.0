import { redirect } from 'next/navigation';
import { getAccountProfile } from '@/lib/account-profile-data';
export default async function MembershipPage() {
  const profile = await getAccountProfile();
  redirect(profile.membershipAction?.href || '/account/profile');
}
