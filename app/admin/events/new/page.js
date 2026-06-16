import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import NewEventChooser from './NewEventChooser';

export default async function NewEventPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  return <NewEventChooser />;
}
