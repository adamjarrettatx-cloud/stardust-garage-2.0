import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The old /capacity tile hub now lives at /bananas/capacity. Door stations
// keep their /capacity/* URLs so device links and QR codes still work.
export default function CapacityHubRedirect() {
  redirect('/bananas/capacity');
}
