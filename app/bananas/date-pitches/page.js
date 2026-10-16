import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import DatePitchesReview from './DatePitchesReview';
import { PITCH_COLUMNS, withConflicts } from './load';

export const revalidate = 0;

export default async function DatePitchesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('date_pitches')
    .select(PITCH_COLUMNS)
    .order('pitch_date', { ascending: true })
    .limit(500);
  if (error) console.error('[date pitches]', error.message);
  const pitches = await withConflicts(data || []);

  return (
    <>
      <AuthenticatedPageHeader
        title="Date Pitches"
        description="Event ideas Programmers send for open dates."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />
      <DatePitchesReview pitches={pitches} />
    </>
  );
}
