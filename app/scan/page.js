import { requireTeam } from '@/lib/auth-helpers';
import UnifiedScanClient from './UnifiedScanClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Door Scanner \u00b7 Stardust Garage',
  robots: { index: false, follow: false },
  other: { 'theme-color': '#0a0a0a' },
};

// /scan  \u2014 the unified Door Scanner.
//
// One camera page for every kind of QR in the Stardust universe:
//
//   1. Trial SDG Pass QR   \u2192 /api/capacity/trial-pass/scan
//   2. Ticket QR           \u2192 /api/tickets/scan
//   3. Member ID QR        \u2192 /api/scan/member-id
//
// The client-side sniffer (lib/scan/sniff.js) reads the QR payload and
// routes it to the right preview endpoint. Staff sees a single preview card
// with the person's photo + name + context, then taps Verify or Reject.
//
// Naming: called "Door Scanner" everywhere in copy. Runs on any device with
// a rear camera + BarcodeDetector API (iPad, iPhone, Android, Chromebook,
// or a webcam laptop). The iPad has just always been the physical hardware
// we set on the front desk.
//
// Legacy scanners:
//   * /capacity/scan  \u2014 trial-pass only (still works; some SOPs link here)
//   * /t/scan         \u2014 tickets only    (still works; still linked from ticket admin)
// Both stay as thin scanners for their single QR type; new SOP points staff
// at /scan.

export default async function ScanPage() {
  await requireTeam();
  return <UnifiedScanClient />;
}
