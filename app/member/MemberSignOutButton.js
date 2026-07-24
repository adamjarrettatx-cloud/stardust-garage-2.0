'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function MemberSignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 border"
      style={{
        borderColor: 'var(--fg-a15)',
        color: 'var(--text-1)',
      }}
    >
      SIGN OUT
    </button>
  );
}
