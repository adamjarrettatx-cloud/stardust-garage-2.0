'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function PartnerSignOutButton() {
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
      style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
    >
      SIGN OUT
    </button>
  );
}
