import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { loadTrialPassAnalytics } from '@/lib/trial-pass-analytics';

// GET /api/team/trial-pass/analytics/event/[eventId]/export
//
// CSV of every trial-pass check-in for a single event, so Adam can drop the
// attendee list into a follow-up email or SMS. Team-authenticated because
// staff already see the same names + emails in the analytics tab, and this
// endpoint returns nothing they cannot already read on-screen.
//
// eventId = "none" is a magic value that exports the front-desk bucket —
// trial-pass check-ins that were logged with no event_id (usually because
// the door was open on a night with no ticketed event).
//
// We deliberately reuse loadTrialPassAnalytics() rather than re-querying:
// the by-event grouping already does the dedup + join, so a second code
// path here would risk drifting from what the UI shows.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CSV_HEADERS = [
  'name',
  'email',
  'phone',
  'phone_verified',
  'signup_source',
  'signed_up_at',
  'checked_in_at',
  'applied_at',
  'converted_at',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Quote if the value contains any character that would otherwise break the
  // row: comma, quote, or newline. Embedded quotes are doubled per RFC 4180.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const out = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    out.push(
      [
        r.fullName,
        r.email,
        r.phone,
        r.phoneVerified ? 'yes' : 'no',
        r.signupSource,
        r.issuedAt,
        r.checkedInAt,
        r.appliedAt,
        r.convertedAt,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  // Trailing newline so `wc -l` on the download matches row count + header.
  return `${out.join('\r\n')}\r\n`;
}

function safeSlug(input, fallback) {
  const s = (input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || fallback;
}

export async function GET(_request, { params }) {
  const gate = await requireTeam();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { eventId } = await params;
  const isNoEvent = eventId === 'none';

  const analytics = await loadTrialPassAnalytics();
  if (!analytics) {
    return NextResponse.json({ error: 'Analytics unavailable' }, { status: 503 });
  }

  const match = analytics.byEvent.find((e) =>
    isNoEvent ? e.eventId === null : e.eventId === eventId,
  );
  if (!match) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const csv = toCsv(match.signups);

  // Filename tries to be human-readable — "2026-09-20-bass-church.csv" — so
  // the file is obviously the right one when Adam has three exports open.
  const datePart = match.eventDate || 'unattributed';
  const titlePart = safeSlug(match.title, isNoEvent ? 'unattributed' : 'event');
  const filename = `trial-signups-${datePart}-${titlePart}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
