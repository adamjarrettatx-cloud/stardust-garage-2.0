import { notFound } from 'next/navigation';
import ApplyForm from './ApplyForm';
import customerContent from '@/lib/customer-content.json';

export default async function ApplyPage({ params }) {
  const { plan } = await params;
  const planInfo = customerContent.membership.plans.find(item => item.slug === plan);

  if (!planInfo) {
    notFound();
  }

  return <ApplyForm planSlug={plan} planName={planInfo.name} planPrice={`${planInfo.price}/mo`} />;
}
