import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { loadTrialPassAnalytics } from '@/lib/trial-pass-analytics';
import AnalyticsDashboard from './AnalyticsDashboard';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Trial Pass Analytics · Stardust Garage',
  robots: { index: false, follow: false },
};

// /team/trial-pass/analytics — trial pass funnel view for team + admin.
//
// Pulls the full analytics payload server-side so the page is instantly
// readable (no client-side loading spinner) and no admin data ever crosses
// into a browser without an authenticated request behind it.
//
// Any team member on shift can view. Every metric is derived from
// trial_passes + trial_pass_checkins; no PII beyond names/emails is exposed.
export default async function TrialPassAnalyticsPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  const analytics = await loadTrialPassAnalytics();

  return (
    <>
      <AuthenticatedPageHeader />
      <main className="min-h-screen px-5 py-10 md:py-14" style={{ background: '#0a0a0a' }}>
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-10">
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-4"
              style={{ color: '#ffb84d', border: '1px solid rgba(255,184,77,0.35)' }}
            >
              TRIAL PASS · ANALYTICS
            </div>
            <h1
              className="text-[32px] md:text-[42px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#ffffff' }}
            >
              Trial Members Funnel
            </h1>
            <p
              className="text-[14px] leading-[1.6] max-w-[640px]"
              style={{ color: 'rgba(255,255,255,0.65)' }}
            >
              From QR scan to full membership. Everything below updates in real time as guests sign up,
              check in at the door, and apply.
            </p>
          </div>

          {analytics ? (
            <AnalyticsDashboard data={analytics} />
          ) : (
            <div
              className="rounded-2xl p-6 text-[14px]"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.65)' }}
            >
              Analytics could not be loaded. Check the Supabase connection and try again.
            </div>
          )}
        </div>
      </main>
    </>
  );
}
