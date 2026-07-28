'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Deleting a contact is admin-only. RLS (is_admin()) is the enforcement — this
// button just surfaces whatever the database says, so a team member who reaches
// it gets the policy's rejection instead of a silent no-op. Mirrors
// DeleteEventButton.js.
export default function DeleteContactButton({ contactId, displayName }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Delete "${displayName}"? This also deletes its edit history and cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from('contacts').delete().eq('id', contactId);

    if (error) {
      alert('Error deleting contact: ' + error.message);
      setDeleting(false);
    } else {
      router.push('/bananas/contacts');
      router.refresh();
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
      style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-text)' }}
    >
      {deleting ? 'DELETING...' : 'DELETE'}
    </button>
  );
}
