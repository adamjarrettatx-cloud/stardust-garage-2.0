'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/bananas/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className="px-5 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
      style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
    >
      SIGN OUT
    </button>
  );
}
