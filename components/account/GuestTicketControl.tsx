'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GuestTicketControl({ ticket }: {
  ticket: { id: string; status: string; reserved_for_guest?: boolean };
}) {
  const router = useRouter();
  const [reserved, setReserved] = useState(ticket.reserved_for_guest === true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  useEffect(() => { setReserved(ticket.reserved_for_guest === true); }, [ticket.id, ticket.reserved_for_guest]);
  async function change() {
    if (inFlight.current) return;
    if (reserved && !window.confirm('Use this ticket for yourself? Your My Pass scan may use it, even if you already sent its screenshot to a guest.')) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/wallet/guest-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.id, reserved_for_guest: !reserved, expected_reserved_for_guest: reserved }),
      });
      const data = await response.json();
      if (!response.ok || data?.ticket?.id !== ticket.id || typeof data?.ticket?.reserved_for_guest !== 'boolean') {
        throw new Error(data?.error || 'Could not confirm the change. Refresh before sharing.');
      }
      setReserved(data.ticket.reserved_for_guest);
      setMessage(data.ticket.reserved_for_guest ? 'Saved for your guest. You can now screenshot this ticket.' : 'Saved for your own pass check-in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not confirm the change. Refresh before sharing.');
    } finally {
      inFlight.current = false; setBusy(false); router.refresh();
    }
  }
  return <div style={{ width: '100%', maxWidth: 360, margin: '16px auto', padding: 16, border: '1px solid rgba(255,255,255,.18)', borderRadius: 12 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{reserved ? 'For a guest' : 'For my pass'}</p>
    <p className="account-hub-note">{ticket.status !== 'valid'
      ? 'This ticket is no longer available for entry or guest changes.'
      : reserved
      ? 'Your My Pass scan will not use this ticket. Send its screenshot to your guest. They must also show their own valid My Pass. One ticket admits one person.'
      : 'Your My Pass scan can use this ticket. Before sending it to someone else, mark it For a guest and wait for confirmation.'}</p>
    {ticket.status === 'valid' && <button type="button" className="account-hub-button secondary" style={{ minHeight: 44 }}
      disabled={busy} onClick={change}>{busy ? 'Saving…' : reserved ? 'Use for myself' : 'For a guest'}</button>}
    {message && <p role="status" className="account-hub-note">{message}</p>}
  </div>;
}
