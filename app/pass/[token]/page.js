import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { qrMatrixToSvg } from '@/lib/qr-code';
import { resolveSiteUrl } from '@/lib/site-url';
import {
  buildPassUrl,
  daysRemaining,
  effectiveExpiry,
  formatPassDate,
  hashPassToken,
  isPassLive,
  isWellFormedPassToken,
  passStatusLabel,
} from '@/lib/trial-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your Trial SDG Pass · Stardust Garage',
  robots: { index: false, follow: false },
};

// /pass/[token] — the guest's own pass, as a web page.
//
// This is the safety net the whole flow rests on. Wallet installs fail, phones
// get replaced, people close the success screen before they save anything. The
// link in their email always works, always renders the current state, and
// always draws the QR as inline SVG (no image loading, no app required).
//
// The token IS the credential: 256 bits of randomness, hashed at rest, handed
// only to the person who typed their own details into the intake form. So this
// page reads the single row that token hashes to and shows nothing that is not
// already the reader's own information — no email, no phone, no other guest.
//
// It talks to the service-role client directly rather than through an API
// route. That is a considered exception to the "service role lives in
// app/api/**" rule: a server component is never bundled to the browser, and a
// guest at the door should not be watching a spinner while the page fetches
// itself. Nothing below is passed to a client component except the rendered
// SVG string and display-safe strings.
export default async function TrialPassViewPage({ params }) {
  const { token } = await params;

  // Reject a malformed token before it becomes a query. A smudged scan or an
  // edited URL is a 404, not a database round trip.
  if (!isWellFormedPassToken(token)) notFound();
  if (!isSupabaseConfigured()) notFound();

  const admin = createAdminClient();
  const { data: pass, error } = await admin
    .from('trial_passes')
    .select('id, full_name, status, issued_at, expires_at, extended_until, applied_at, converted_at')
    .eq('qr_token_hash', hashPassToken(token))
    .maybeSingle();

  if (error) {
    console.error('[trial-pass.view]', error);
    notFound();
  }
  if (!pass) notFound();

  const live = isPassLive(pass);
  const expiry = effectiveExpiry(pass);
  const daysLeft = daysRemaining(pass);
  const statusLabel = passStatusLabel(pass);
  const firstName = String(pass.full_name || '').split(' ')[0] || 'there';

  // The QR encodes this page's own URL, so a scan at the door resolves to the
  // same token the guest is looking at. Regenerated per render rather than
  // stored — it is derived data.
  const passUrl = buildPassUrl(resolveSiteUrl(), token);
  const qrSvg = qrMatrixToSvg(passUrl, { size: 260, dark: '#0a0a0a', light: '#ffffff' });

  const accent = live ? '#4ade80' : '#ff8a8a';

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-20">
      <div className="max-w-[420px] w-full mx-auto text-center">
        <div
          className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] px-3.5 py-1.5 rounded-full mb-6"
          style={{ color: accent, border: `1px solid ${accent}44` }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: accent }}
            aria-hidden="true"
          />
          {statusLabel.toUpperCase()}
        </div>

        <h1
          className="text-[28px] md:text-[34px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-2"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#ffffff' }}
        >
          {firstName}&apos;s Trial SDG Pass
        </h1>
        <p className="text-[14px] leading-[1.6] mb-7" style={{ color: 'rgba(255,255,255,0.65)' }}>
          {live
            ? 'Show this code at the door. Staff scan it and your access is checked automatically.'
            : 'This pass has expired. Ask a staff member at the door about extending it, or apply for membership.'}
        </p>

        {live && qrSvg ? (
          <div
            className="inline-block rounded-2xl p-4"
            style={{ background: '#ffffff' }}
            aria-label="Trial SDG Pass QR code"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}

        <div
          className="mt-7 rounded-xl px-5 py-4 text-left"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="text-[10px] font-semibold tracking-[0.16em] mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {live ? 'GOOD THROUGH' : 'EXPIRED ON'}
          </div>
          <div className="text-[15px] font-semibold" style={{ color: '#ffffff' }}>
            {formatPassDate(expiry)}
            {live && daysLeft <= 7 ? (
              <span style={{ color: accent, fontWeight: 600 }}>
                {' '}
                · {daysLeft === 0 ? 'today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
              </span>
            ) : null}
          </div>
        </div>

        {pass.applied_at ? (
          <p className="text-[12px] mt-5 leading-[1.6]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Your membership application is in — we&apos;ll be in touch.
          </p>
        ) : (
          // /members, not /members/apply/<plan>: the application form is
          // per-plan and a trial guest has not picked one yet, so send them to
          // the chooser rather than guessing a tier for them.
          <a
            href="/members"
            className="inline-block mt-6 px-7 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-transform hover:-translate-y-0.5"
            style={{ background: '#ffb84d', color: '#0a0a0a' }}
          >
            APPLY FOR MEMBERSHIP
          </a>
        )}

        <p className="text-[11px] mt-6 leading-[1.6]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Covers Friday through Sunday music events. A ticket is still required for ticketed nights.
        </p>
      </div>
    </main>
  );
}
