import { redirect } from 'next/navigation';

// The old Event Financials page was replaced by the Financial Write-Up.
export default async function EventFinancialsRedirect({ params }) {
  const { id } = await params;
  redirect(`/bananas/events/${id}/writeup`);
}
