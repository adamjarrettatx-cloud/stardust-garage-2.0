import { getAccountProfile } from '@/lib/account-profile-data';
import AccountHub from '@/components/account/AccountHub';
import './account.css';

export default async function AccountLayout({ children }) {
  const profile = await getAccountProfile();
  return <AccountHub profile={profile}>{children}</AccountHub>;
}
