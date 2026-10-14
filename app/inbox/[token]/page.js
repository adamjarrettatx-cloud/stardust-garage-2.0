import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { claimInvite, conversationTypeMeta, maskEmail } from '@/lib/submission-conversations';
import { findAuthUserByEmail } from '@/lib/trial-pass-account';
import InboxGate from './InboxGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your conversation · Stardust Garage',
  robots: { index: false, follow: false },
};

// /inbox/[token] — where a conversation invite email lands.
//
// The token alone never shows the conversation. It only lets the matching
// Stardust account attach the thread to itself: sign in (or create a free
// account) with the invited email, and the server links the thread and
// forwards to /account/messages/<id>. Everything else gets a plain
// explanation and no message content.
export default async function ConversationInvitePage({ params }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return <Shell title="Messages are unavailable" body="Please try again in a few minutes." />;

  const { user } = await getCurrentUser();
  const result = await claimInvite({ token, user });
  if (result.ok) redirect(`/account/messages/${result.threadId}`);

  const thread = result.thread;
  const typeLabel = thread ? conversationTypeMeta(thread.submission_type)?.label || 'Submission' : null;

  switch (result.reason) {
    case 'signed_out': {
      let hasAccount = false;
      try {
        hasAccount = Boolean(await findAuthUserByEmail(createAdminClient(), result.invite.email));
      } catch {
        hasAccount = false;
      }
      return (
        <Shell eyebrow={typeLabel} title={thread.subject} body="The Stardust Garage team wants to follow up with you. Your conversation lives in your free Stardust account so everything stays in one place.">
          <InboxGate email={result.invite.email} hasAccount={hasAccount} />
        </Shell>
      );
    }
    case 'email_mismatch':
      return (
        <Shell eyebrow={typeLabel} title="Use the invited email" body={`This invite was sent to ${maskEmail(result.invite.email)}. You're signed in as ${user.email}. Sign out, then continue with the invited email address.`}>
          <InboxGate signOutOnly />
        </Shell>
      );
    case 'claimed_other':
      return <Shell eyebrow={typeLabel} title="Already linked" body="This conversation is linked to a different Stardust account. Sign in with that account to open it." />;
    case 'revoked':
      return <Shell title="This link was replaced" body="We sent a newer invite. Please use the most recent email from Stardust Garage." />;
    case 'expired':
      return <Shell title="This link expired" body="Email hello@sdgatx.com and we'll send you a new one." />;
    default:
      return <Shell title="Link not found" body="This invite link isn't valid. Check that you opened the full link from your email." />;
  }
}

function Shell({ eyebrow = null, title, body, children = null }) {
  return (
    <main className="max-w-[520px] mx-auto px-5 sm:px-6 py-12 sm:py-16">
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: '#d9c48c' }}>
        {(eyebrow || 'STARDUST GARAGE').toUpperCase()}
      </div>
      <h1 className="text-[30px] sm:text-[38px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {title}
      </h1>
      <p className="text-[15px] leading-[1.65] mb-8" style={{ color: 'rgba(255,255,255,0.75)' }}>{body}</p>
      {children}
    </main>
  );
}
