'use client';

import { useRouter } from 'next/navigation';
import AccountGate from '@/app/components/AccountGate';
import { createClient } from '@/lib/supabase/client';

// Signed-out visitors sign in or create their free account with the invited
// email; the server page then links the conversation and forwards them.
export default function InboxGate({ email = '', hasAccount = false, signOutOnly = false }) {
  const router = useRouter();

  if (signOutOnly) {
    return (
      <button
        type="button"
        onClick={async () => { await createClient().auth.signOut(); router.refresh(); }}
        className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em]"
        style={{ background: '#ffffff', color: '#0a0a0a' }}
      >
        SIGN OUT
      </button>
    );
  }

  return (
    <AccountGate
      defaultTab={hasAccount ? 'signin' : 'signup'}
      prefillEmail={email}
      headline={hasAccount ? 'Sign in to reply' : 'Create your account to reply'}
      subheadline={`Use ${email} so we can match you to this conversation.`}
      onSuccess={() => router.refresh()}
    />
  );
}
