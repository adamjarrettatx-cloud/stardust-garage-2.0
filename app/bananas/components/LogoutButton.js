'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className="px-5 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors auth-theme-border-button"
    >
      SIGN OUT
    </button>
  );
}
