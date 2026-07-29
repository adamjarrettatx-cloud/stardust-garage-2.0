import { redirect } from 'next/navigation';

export const revalidate = 0;

// The partner area has exactly one page today, so /partner is just the entry
// point middleware.js redirects to. Phase 3 adds /partner/guest-list and this
// becomes a real dashboard.
export default function PartnerHome() {
  redirect('/partner/profile');
}
