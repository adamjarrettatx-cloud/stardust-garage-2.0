import { notFound, redirect } from 'next/navigation';
import { getMyConversation } from '@/lib/submission-conversations';
import ConversationThread from './ConversationThread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AccountConversationPage({ params }) {
  const { id } = await params;
  const result = await getMyConversation({ threadId: id });
  if (result.status === 401) redirect(`/login?next=${encodeURIComponent(`/account/messages/${id}`)}`);
  if (result.status === 404) notFound();
  if (result.status !== 200) {
    return <p className="account-hub-error" role="alert">{result.body?.error || 'This conversation could not be loaded.'}</p>;
  }
  return <ConversationThread initial={result.body} />;
}
