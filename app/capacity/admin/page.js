import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Capacity Setup (session controls, device links, audit log) moved into
// /bananas/capacity. Keep this URL alive for bookmarks.
export default function CapacityAdminRedirect() {
  redirect('/bananas/capacity?tab=devices');
}
