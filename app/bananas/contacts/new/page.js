import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import ContactForm from '../ContactForm';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function NewContactPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  return (
    <main className="max-w-[700px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas/contacts"
        backLabel="← BACK TO CONTACTS"
        title="New Contact"
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <ContactForm />
    </main>
  );
}
