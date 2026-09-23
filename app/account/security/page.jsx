import PasswordSettings from '@/components/account/PasswordSettings';
import SignOutButton from '../SignOutButton';

export default function SecurityPage() {
  return <>
    <div className="account-hub-intro"><h2>Login &amp; security</h2><p>Manage your password and sign out of this account.</p></div>
    <PasswordSettings />
    <section className="account-hub-panel"><div className="account-hub-panel-heading"><h3>Signed-in session</h3><SignOutButton /></div><p className="account-hub-note account-hub-padded">On a shared device, sign out when you finish. Your profile and tickets will remain in your account.</p></section>
  </>;
}
