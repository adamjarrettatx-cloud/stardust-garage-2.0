import { getAccountProfile } from '@/lib/account-profile-data';
import AccountAccess from '@/components/account/AccountAccess';

export default async function MembershipPage() {
  const profile = await getAccountProfile();
  return <>
    <div className="account-hub-intro"><h2>Membership &amp; access</h2><p>Your current membership, partner relationship, and assigned workspaces.</p></div>
    <AccountAccess profile={profile} showWorkspaces />
  </>;
}
