import { redirect } from 'next/navigation';

// Event Analytics has been merged into the unified Financials page, which
// combines this page's per-event performance table with the Financial
// Calendar's day-by-day income view and manual income entry. This route is
// kept as a redirect so old links/bookmarks still land somewhere useful.
export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  redirect('/bananas/financials');
}
