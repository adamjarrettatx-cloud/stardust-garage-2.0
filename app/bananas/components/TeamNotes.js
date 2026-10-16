import TeamNotesPanel from './TeamNotesPanel';
import { listSubmissionNotes } from '@/lib/submission-notes';

// Server wrapper: loads the current notes with the same admin/MFA check as
// the API, so the panel renders populated on first paint.
export default async function TeamNotes({ submissionType, submissionId }) {
  const result = await listSubmissionNotes({ type: submissionType, id: submissionId });
  const ok = result.status === 200;
  return (
    <TeamNotesPanel
      submissionType={submissionType}
      submissionId={submissionId}
      initialNotes={ok ? result.body.notes : []}
      loadError={ok ? null : result.body?.error || 'Could not load team notes.'}
    />
  );
}
