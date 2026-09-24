import { redirect } from 'next/navigation';

export const revalidate = 0;

// All partner types enter through their self-profile, not an assumed guest list.
export default function PartnerHome() {
  redirect('/portal/profile');
}
