import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import ContactForm from '../ContactForm';
import { contactDirectorySection } from '@/lib/contact-helpers';

export const revalidate = 0;

export default async function NewContactPage({ searchParams }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');
  const category = contactDirectorySection((await searchParams)?.category)?.value || null;

  return (
    <div className="max-w-[1160px] w-full">
      <ContactForm initialCategory={category} />
    </div>
  );
}
