import { redirect } from 'next/navigation';

export const revalidate = 0;

// /partner is the entry point middleware.js redirects partners to. There is no
// dashboard because there would be nothing on it to summarise: the guest list
// is why a promoter opens this at all, so send them straight there rather than
// making them tap through a landing page on a phone in a green room.
export default function PartnerHome() {
  redirect('/portal/guest-list');
}
