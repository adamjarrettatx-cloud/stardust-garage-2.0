import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import EventForm from '../../components/EventForm';

export default async function NewEventPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  return <EventForm />;
}
