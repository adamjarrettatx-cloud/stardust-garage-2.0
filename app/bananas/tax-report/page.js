import { redirect } from 'next/navigation';
import { ownerPageGate } from '@/lib/auth-helpers';
import TaxReportClient from './TaxReportClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Owner-only Texas sales-tax report for internal ticketing. Server-gated
// (same pattern as Financials / Cash Flow); the nav tile is NOT the security
// boundary. Data is fetched client-side from /api/admin/tickets/tax-report
// so the date-range picker doesn't trigger a full page reload.
export default async function TaxReportPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);
  return <TaxReportClient />;
}
