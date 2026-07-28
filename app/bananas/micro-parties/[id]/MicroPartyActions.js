'use client';

import SubmissionActions from '@/app/bananas/components/SubmissionActions';

export default function MicroPartyActions({ inquiryId, currentStatus }) {
  return <SubmissionActions type="micro-parties" id={inquiryId} currentStatus={currentStatus} />;
}
