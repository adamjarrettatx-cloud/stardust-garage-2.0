import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import ContactsList from './ContactsList';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

// Team-gated, not admin-gated: admins and team members both maintain the
// directory (only DELETE is admin-only, enforced by RLS).
export default async function ContactsPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  const supabase = await createClient();
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .order('display_name', { ascending: true });

  return (
    <>
      <AuthenticatedPageHeader
        title="Contacts"
        description="The people, collectives, renters and vendors SDG does business with. Relationships live here so they stay with the org."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      <ContactsList contacts={contacts || []} />
    </>
  );
}
