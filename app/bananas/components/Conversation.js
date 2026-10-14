import ConversationPanel from './ConversationPanel';
import { firstName, getTeamConversation } from '@/lib/submission-conversations';

// Server wrapper: loads the conversation with the same admin/MFA check as
// the API so the panel renders populated on first paint. Viewing it marks the
// submitter's replies as read for the team.
export default async function Conversation({ submissionType, submissionId, topic = null }) {
  const result = await getTeamConversation({ type: submissionType, id: submissionId });
  const ok = result.status === 200;
  const name = ok ? firstName(result.body.submission?.name) : '';
  const about = topic || (ok ? result.body.submission?.subject : null) || 'what you sent us';
  const defaultOpening = `Hi ${name || 'there'},\n\nThanks for reaching out about ${about}. We'd love to learn a little more before we plan next steps.\n\n`;
  return (
    <ConversationPanel
      submissionType={submissionType}
      submissionId={submissionId}
      initial={ok ? result.body : null}
      loadError={ok ? null : result.body?.error || 'Could not load the conversation.'}
      defaultOpening={defaultOpening}
    />
  );
}
