import { redirect } from 'next/navigation';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Front Desk · Stardust Garage',
  robots: { index: false, follow: false },
};

// Manual issuance is available only inside Front Desk. Preserve old bookmarks
// without maintaining a second form; the destination enforces its own
// requireFrontDeskOrTeam gate before exposing guest data or issuance controls.
export default function ManualTrialPassPage() {
  redirect('/capacity/front-desk');
}
