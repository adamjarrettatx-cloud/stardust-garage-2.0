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
//
// Rendered inside the admin shell (see app/team/layout.js): the shell owns
// the outer header, sidebar, breadcrumb and page container. The dashboard's
// KPI cards, funnel bar and tables use the hex values that globals.css
// remaps for light mode, so the whole page rethemes correctly with the shell.
export default async function TrialPassAnalyticsPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  const analytics = await loadTrialPassAnalytics();

  return (
    <>
      <AuthenticatedPageHeader
        title="Trial Members Funnel"
        description="From QR scan to full membership. Everything below updates in real time as guests sign up, check in at the door, and apply."
        eyebrow="TRIAL PASS · ANALYTICS"
        titleClassName="text-[30px] md:text-[36px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      {analytics ? (
        <AnalyticsDashboard data={analytics} />
      ) : (
        <div
          className="rounded-2xl p-6 text-[14px] border"
          style={{
            background: 'var(--auth-card-bg)',
            color: 'var(--auth-muted)',
            borderColor: 'var(--auth-card-border)',
          }}
        >
          Analytics could not be loaded. Check the Supabase connection and try again.
        </div>
      )}
    </>
  );
}
