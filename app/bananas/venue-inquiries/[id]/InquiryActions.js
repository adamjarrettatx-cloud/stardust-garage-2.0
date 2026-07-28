'use client';

import SubmissionActions from '@/app/bananas/components/SubmissionActions';

export default function InquiryActions({ inquiryId, currentStatus }) {
  return <SubmissionActions type="venue-inquiries" id={inquiryId} currentStatus={currentStatus} />;
}
