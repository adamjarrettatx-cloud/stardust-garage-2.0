import TrialPassForm from './TrialPassForm';

// /pass — the destination of every printed QR code in the venue (bathroom-stall
// fliers, table cards, the front desk). Kept at the shortest URL that still
// reads as a noun so it fits on a card and survives being typed by hand.
//
// Deliberately public and unauthenticated: a first-time guest has no account,
// and asking them to make one before they have seen the place is how a trial
// program dies. The gate is /api/trial-pass/create, not this page.

export const metadata = {
  title: 'Get Your Trial Pass · Stardust Garage',
  description: 'Three questions and your Trial SDG Pass is ready — faster check-in at the door.',
  // Printed-QR landing page. Not something we want indexed and offered to
  // people who have never set foot in the building.
  robots: { index: false, follow: false },
};

export default function TrialPassPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-20">
      <TrialPassForm />
    </main>
  );
}
