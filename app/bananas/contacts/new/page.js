import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import ContactForm from '../ContactForm';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { contactDirectorySection, contactDirectoryHref } from '@/lib/contact-helpers';

export const revalidate = 0;

export default async function NewContactPage({ searchParams }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');
  const category = contactDirectorySection((await searchParams)?.category)?.value || null;

  return (
    <div className="max-w-[700px]">
      <AuthenticatedPageHeader
        backHref={contactDirectoryHref(category)}
        backLabel="← BACK TO CONTACTS"
        title="New Contact"
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <ContactForm initialCategory={category} />
    </div>
  );
}
