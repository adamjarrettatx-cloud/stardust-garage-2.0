import { notFound } from 'next/navigation';
import ApplyForm from './ApplyForm';

const VALID_PLANS = {
  'cowork': { name: 'Cowork', price: '$155/mo' },
  // 'cowork-party' is the legacy slug for the tier now marketed as "Experience".
  // Slug preserved so existing Stripe prices, applications, and member records keep working.
  'cowork-party': { name: 'Experience', price: '$225/mo' },
  // TODO(weekender): Stripe price IDs for The Weekender ($48/mo) still need to be created
  // and wired into lib/stripe-prices.js + app/api/stripe/checkout/route.js before this plan
  // can complete a paid checkout. The application form itself will render.
  'weekender': { name: 'The Weekender', price: '$48/mo' },
};

export default async function ApplyPage({ params }) {
  const { plan } = await params;
  const planInfo = VALID_PLANS[plan];

  if (!planInfo) {
    notFound();
  }

  return <ApplyForm planSlug={plan} planName={planInfo.name} planPrice={planInfo.price} />;
}
