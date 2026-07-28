'use client';

import SubmissionActions from '@/app/bananas/components/SubmissionActions';

export default function CollaborationActions({ collaborationId, currentStatus }) {
  return <SubmissionActions type="collaborations" id={collaborationId} currentStatus={currentStatus} />;
}
