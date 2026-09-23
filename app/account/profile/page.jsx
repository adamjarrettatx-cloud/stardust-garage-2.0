import { getAccountProfile } from '@/lib/account-profile-data';
import PersonalDetails from '@/components/account/PersonalDetails';
import AccountAccess from '@/components/account/AccountAccess';
import ProfileClient from '@/app/portal/(loggedin)/profile/ProfileClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AccountProfilePage() {
  const profile = await getAccountProfile();
  return <>
    <div className="account-hub-intro"><h2>Your profile</h2><p>Your personal details and relationship with Stardust, in one place.</p></div>
    <PersonalDetails profile={profile} />
    <AccountAccess profile={profile} />
    {profile.partnerActive && <ProfileClient profile={profile.partner} />}
  </>;
}
