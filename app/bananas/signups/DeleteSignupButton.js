'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function DeleteSignupButton({ signupId }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    const confirmed = window.confirm('Remove this signup?');
    if (!confirmed) return;

    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from('signups').delete().eq('id', signupId);

    if (error) {
      alert('Error: ' + error.message);
      setDeleting(false);
    } else {
      router.refresh();
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
      style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
    >
      {deleting ? '...' : 'DELETE'}
    </button>
  );
}
