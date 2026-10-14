import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMyConversations } from '@/lib/submission-conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Conversations with the Stardust Garage team about something this account
// sent us (a venue inquiry, collaboration, micro party or application).
export default async function AccountMessagesPage() {
  const result = await listMyConversations();
  if (result.status === 401) redirect('/login?next=/account/messages');
  const items = result.status === 200 ? result.body.conversations : [];

  return (
    <section className="account-messages" aria-labelledby="account-messages-title">
      <div className="account-messages-heading">
        <h2 id="account-messages-title">Messages</h2>
        <Link href="/account/profile" className="account-hub-text-button">Back to profile</Link>
      </div>
      {result.status !== 200 ? (
        <p className="account-hub-error" role="alert">{result.body?.error || 'Your messages could not be loaded.'}</p>
      ) : items.length === 0 ? (
        <div className="account-hub-panel account-hub-padded">
          <p className="account-hub-note">No messages yet. When our team follows up on something you sent us, the conversation appears here.</p>
        </div>
      ) : (
        <ul className="account-messages-list">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/account/messages/${c.id}`} className={c.unread ? 'is-unread' : undefined}>
                <span className="account-messages-dot" aria-hidden="true" />
                <span className="account-messages-main">
                  <span className="account-messages-subject">{c.subject}</span>
                  <span className="account-messages-meta">{c.type_label}{c.status === 'closed' ? ' · Closed' : ''}</span>
                  {c.preview && <span className="account-messages-preview">{c.preview.author_name}: {c.preview.body}</span>}
                </span>
                <span className="account-messages-side">
                  {c.open_questions > 0 && c.status === 'open' && (
                    <span className="account-messages-badge">{c.open_questions === 1 ? '1 question' : `${c.open_questions} questions`}</span>
                  )}
                  <span className="account-messages-date">{formatWhen(c.last_activity_at)}</span>
                </span>
                {c.unread && <span className="sr-only">Unread</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
