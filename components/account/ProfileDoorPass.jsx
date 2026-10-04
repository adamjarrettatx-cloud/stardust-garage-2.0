import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getAccountProfile } from '@/lib/account-profile-data';
import { getAccountTrialPassCredential } from '@/lib/account-trial-pass';
import { qrMatrixToSvg } from '@/lib/qr-code';
import { resolveSiteUrl } from '@/lib/site-url';
import { buildPassUrl, effectiveExpiry, formatPassDate, isActivated } from '@/lib/trial-pass';

// Door credential at the top of the profile: the guest's Trial SDG Pass QR,
// or a direct Member ID button for members. Read-only display; the door
// scanner remains the authority on whether the pass admits tonight.
export default async function ProfileDoorPass() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // Awaiting the cached profile guarantees the email-based pass link has run
  // before this component reads by user_id.
  const profile = await getAccountProfile();

  let credential = { pass: null };
  try {
    credential = await getAccountTrialPassCredential({ admin: createAdminClient(), userId: user.id });
  } catch {
    return <section className="account-hub-panel profile-door-pass" aria-labelledby="door-pass-title">
      <div className="account-hub-panel-heading"><h2 id="door-pass-title">Trial SDG Pass</h2></div>
      <p className="account-hub-padded account-hub-note">Your pass could not be loaded right now. Refresh the page, or give your name at the front desk.</p>
    </section>;
  }

  const { pass, token } = credential;
  if (!pass) {
    if (!profile.hasMemberProfile) return null;
    return <section className="account-hub-panel profile-door-pass" aria-labelledby="door-pass-title">
      <div className="account-hub-panel-heading"><h2 id="door-pass-title">Member ID</h2></div>
      <div className="account-hub-padded">
        <p className="account-hub-note" style={{ marginTop: 0 }}>Show your Member ID QR at the door.</p>
        <div className="account-hub-actions"><Link className="account-hub-button" href="/member/id">Show Member ID</Link></div>
      </div>
    </section>;
  }

  const passUrl = token ? buildPassUrl(resolveSiteUrl(), token) : null;
  const qrSvg = passUrl ? qrMatrixToSvg(passUrl, { size: 280, dark: '#0a0a0a', light: '#ffffff' }) : null;
  const activated = isActivated(pass);
  const status = activated ? `Good through ${formatPassDate(effectiveExpiry(pass))}` : 'Your 30 days start at your first check-in';

  return <section className="account-hub-panel profile-door-pass" aria-labelledby="door-pass-title">
    <div className="account-hub-panel-heading">
      <h2 id="door-pass-title">Trial SDG Pass</h2>
      {passUrl && <Link className="account-hub-text-button" href={`/pass/${encodeURIComponent(token)}`}>Full screen</Link>}
    </div>
    <div className="profile-door-pass-body">
      {qrSvg
        ? <div className="profile-door-pass-qr" role="img" aria-label="Trial SDG Pass QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        : <p className="account-hub-note">Your QR could not be drawn right now. Give your name at the front desk.</p>}
      <div className="profile-door-pass-copy">
        <p className="profile-door-pass-lead">Show this code at the door.</p>
        <p className="account-hub-note">{status}.</p>
        <p className="account-hub-note">Covers Weekend Music Experiences. A ticket is still required for ticketed nights.</p>
      </div>
    </div>
  </section>;
}
