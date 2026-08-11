import { redirect } from 'next/navigation';

// Financial Calendar has been merged into the unified Financials page, which
// combines this page's day-by-day income calendar and manual income entry
// with Event Analytics' per-event performance table. This route is kept as a
// redirect so old links/bookmarks still land somewhere useful.
export const dynamic = 'force-dynamic';

export default function FinancialCalendarPage() {
  redirect('/bananas/financials');
}
