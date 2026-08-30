import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import ManualTrialPassForm from './ManualTrialPassForm';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Manual Trial Pass · Stardust Garage',
  robots: { index: false, follow: false },
};

// /team/trial-pass/manual — the escape hatch for guests who cannot receive
// SMS at the door. Dead phone, foreign number, elderly guest whose phone
// number is a landline, three failed Twilio sends — staff types the name,
// phone, and email, hits Create, and the guest walks away with a pass just
// like the self-serve flow would have given them.
//
// Same identity rules apply (canonical email + phone unique index), so a
// staff signup for someone who already has a pass returns their existing
// pass with a rotated token rather than starting a new 30-day window.
//
// Any team member on shift (team_members.role in team/admin) may use it.
// The row records created_by, so a run of manual signups traced to the
// same team member is visible to Adam in the admin trial list.
//
// Rendered inside the admin shell (see app/team/layout.js): this page
// contributes just its content — the shell owns the outer header, sidebar,
// breadcrumb and page container. Hardcoded dark chrome would double up.
export default async function ManualTrialPassPage() {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  return (
    <>
      <AuthenticatedPageHeader
        title="Create a Trial Pass"
        description="For guests who can’t receive the SMS verification — dead phone, foreign number, landline. This creates a Trial SDG Pass without the code step and records that you did it."
        eyebrow="FRONT DESK OVERRIDE"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      <div className="max-w-[520px]">
        <ManualTrialPassForm createdByEmail={user?.email || null} />
      </div>
    </>
  );
}
