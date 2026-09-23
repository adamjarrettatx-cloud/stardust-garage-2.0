import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import ContactsList from './ContactsList';

export const revalidate = 0;

// Team-gated, not admin-gated: admins and team members both maintain the
// directory. Contacts are archived rather than deleted.
export default async function ContactsPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  const supabase = await createClient();
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .order('display_name', { ascending: true });

  return <ContactsList contacts={contacts || []} />;
}
