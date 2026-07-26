import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CollaborationsList from './CollaborationsList';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function CollaborationsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: collabs } = await supabase
    .from('collaborations')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas"
        backLabel="← BACK TO ADMIN"
        title="Collaborations"
        description="Submissions from the Collaborate page (DJs and Artists)."
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <CollaborationsList collabs={collabs || []} />
    </main>
  );
}
