import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePartner } from '@/lib/auth-helpers';
import { auditGuestlist, canRemoveEntry } from '@/lib/guestlist-helpers';

export const runtime = 'nodejs';

// DELETE /api/portal/guestlist/entries/:id
//
// Withdraws a name the partner put on their own list.
//
// Only a pending entry can go. A checked_in guest has already walked through
// the door, and letting the partner delete that row would quietly rewrite who
// actually attended — the one thing the door log is for. RLS cannot express
// this (its delete policy sees ownership, not status), and the UI hiding the
// button is not a control, so the status check happens here and the row is read
// back before the delete to make it on the server's terms rather than the
// client's.
//
// Ownership needs no explicit check: both statements below run as the caller,
// so the Phase 1 partner_owns_grant() policies scope the read AND the delete to
// this partner's own entries. Another partner's id reads back as "not found".
export async function DELETE(request, { params }) {
  try {
    const { user, unauthorized } = await requirePartner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Which guest?' }, { status: 400 });
    }

    const supabase = await createClient();

    // The partner's own session, so the select policy already limits this to
    // entries under their grants — an id belonging to another partner reads
    // back as "not found", which is also what we want to tell them.
    const { data: entry } = await supabase
      .from('event_guestlist_entries')
      .select('id, grant_id, guest_name, comp_type, status')
      .eq('id', id)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: 'Guest not found.' }, { status: 404 });
    }

    if (!canRemoveEntry(entry)) {
      return NextResponse.json(
        {
          error:
            entry.status === 'checked_in'
              ? `${entry.guest_name} has already checked in and can't be removed.`
              : `${entry.guest_name} was marked as a no-show by our door staff and can't be removed.`,
          code: 'not_pending',
        },
        { status: 409 }
      );
    }

    // Re-stating the status in the delete closes the gap between the read above
    // and this statement: if the door checked them in a moment ago, this
    // matches nothing rather than deleting a checked-in guest.
    const { data: deleted, error: deleteError } = await supabase
      .from('event_guestlist_entries')
      .delete()
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (deleteError) {
      console.error('[partner guestlist] entry delete failed', deleteError);
      return NextResponse.json({ error: 'Could not remove that guest.' }, { status: 400 });
    }
    if (!deleted) {
      return NextResponse.json(
        { error: `${entry.guest_name} was just checked in and can't be removed.`, code: 'not_pending' },
        { status: 409 }
      );
    }

    try {
      await auditGuestlist({
        admin: createAdminClient(),
        action: 'entry_removed',
        grantId: entry.grant_id,
        // The row is gone and the FK is ON DELETE SET NULL, so this id is
        // recorded for the history rather than as a live reference.
        entryId: null,
        actorId: user.id,
        actorEmail: user.email,
        request,
        details: {
          grant_id: entry.grant_id,
          entry_id: entry.id,
          guest_name: entry.guest_name,
          comp_type: entry.comp_type,
        },
      });
    } catch (err) {
      console.error('[partner guestlist] could not write entry_removed audit row', err);
    }

    return NextResponse.json({ ok: true, id: entry.id });
  } catch (err) {
    console.error('[partner guestlist] remove entry route error', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
