import { notFound } from 'next/navigation';
import ApplyForm from './ApplyForm';

const VALID_PLANS = {
  'cowork': { name: 'The Builder', price: '$155/mo' },
  // 'cowork-party' is the legacy slug for the tier now marketed as "The Insider".
  // Slug preserved so existing Stripe prices, applications, and member records keep working.
  'cowork-party': { name: 'The Insider', price: '$225/mo' },
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
