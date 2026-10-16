import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import Conversation from '@/app/bananas/components/Conversation';
import TeamNotes from '@/app/bananas/components/TeamNotes';
import PitchCard from '../PitchCard';
import { PITCH_COLUMNS, withConflicts } from '../load';

export const revalidate = 0;

export default async function DatePitchDetail({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from('date_pitches').select(PITCH_COLUMNS).eq('id', id).maybeSingle();
  if (error || !data) notFound();
  const [pitch] = await withConflicts([data]);

  return (
    <div className="max-w-[860px]">
      <AuthenticatedPageHeader
        backHref="/bananas/date-pitches"
        backLabel="← BACK TO DATE PITCHES"
        title="Date Pitch"
        className="mb-6"
      />
      <PitchCard pitch={pitch} showDetailLink={false} />
      <div className="mt-8">
        <Conversation submissionType="date-pitches" submissionId={pitch.id} />
      </div>
      <div className="mt-8">
        <TeamNotes submissionType="date-pitches" submissionId={pitch.id} />
      </div>
    </div>
  );
}
