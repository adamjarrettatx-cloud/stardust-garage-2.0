import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: "You're on the list · Stardust Garage",
  robots: { index: false, follow: false },
};

// /g/[token] — the landing page a guest hits from their invite email.
//
// The token stamped by 20260912_guestlist_guest_email.sql is the ONLY credential;
// nobody signs in to reach this page. We show the guest what event they're on
// the list for, then push them toward the free-account signup flow so they
// have a QR to show at the door and get the app installed before the night.
//
// Everything shown here is either (a) the guest's own name they gave the
// partner, or (b) public event metadata. No partner info, no other guests, no
// grant totals. The service-role read is a considered exception to the
// "service role lives in app/api/**" rule for the same reason /pass/[token]
// uses one: a server component is never bundled to the browser, and a person
// tapping an emailed link should not watch a spinner.
export default async function GuestListLandingPage({ params }) {
  const { token } = await params;

  // Cheap shape check before we hit the database. The trigger mints a base64url
  // string with no padding: characters, digits, dash, underscore, ~24 long.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    notFound();
  }
  if (!isSupabaseConfigured()) notFound();

  const admin = createAdminClient();

  // One join: entry -> grant -> event. RLS is bypassed by the admin client,
  // which is fine because the token itself is the credential.
  const { data: entry, error } = await admin
    .from('event_guestlist_entries')
    .select(
      `id, guest_name, guest_email, comp_type, status,
       grant:event_guestlist_grants!inner (
         id, discount_detail,
         event:events!inner (
           id, title, event_date, event_time, category
         )
       )`
    )
    .eq('invite_token', token)
    .maybeSingle();

  if (error) {
    console.error('[guestlist.landing]', error);
    notFound();
  }
  if (!entry || !entry.grant?.event) notFound();

  const event = entry.grant.event;
  const eventDate = formatEventDate(event.event_date);
  const firstName = String(entry.guest_name || '').split(' ')[0] || 'there';
  const isCheckedIn = entry.status === 'checked_in';
  const isFree = entry.comp_type === 'free';
  const discountDetail = entry.grant.discount_detail || null;

  return (
    <main className="max-w-[560px] mx-auto px-5 sm:px-6 py-12 sm:py-16">
      <div
        className="text-[11px] font-semibold tracking-[0.28em] mb-3"
        style={{ color: '#d9c48c' }}
      >
        YOU&rsquo;RE ON THE LIST
      </div>
      <h1
        className="text-[34px] sm:text-[44px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-6"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Hey {firstName}.
      </h1>

      <div
        className="rounded-[18px] border p-6 sm:p-7 mb-6"
        style={{
          background: 'rgba(20,20,20,0.55)',
          borderColor: 'rgba(217,196,140,0.35)',
        }}
      >
        <div
          className="text-[11px] font-semibold tracking-[0.16em] mb-2"
          style={{ color: '#d9c48c' }}
        >
          {eventDate}
          {event.event_time ? ` · ${event.event_time}` : ''}
        </div>
        <h2
          className="text-[22px] sm:text-[26px] font-bold leading-[1.2] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {event.title}
        </h2>
        <p
          className="text-[14px] leading-[1.6]"
          style={{ color: 'rgba(255,255,255,0.75)' }}
        >
          {isFree
            ? 'Your name is on the door for free entry.'
            : discountDetail
              ? `Your name is on the door for a discount: ${discountDetail}.`
              : 'Your name is on the door for a discount at entry.'}
        </p>
      </div>

      {isCheckedIn ? (
        // Somebody scanned this guest in already. Nothing more to do here —
        // this branch mostly exists so a person tapping the link the next
        // morning does not see "get the app before doors" copy that reads
        // absurd in hindsight.
        <p
          className="text-[14px] leading-[1.6]"
          style={{ color: 'rgba(255,255,255,0.65)' }}
        >
          You&rsquo;re already checked in. Have a great night.
        </p>
      ) : (
        <>
          <p
            className="text-[14px] leading-[1.6] mb-6"
            style={{ color: 'rgba(255,255,255,0.75)' }}
          >
            Two quick steps before you walk in:
          </p>

          <ol className="space-y-4 mb-8">
            <Step
              n={1}
              title="Finish your free profile"
              body="Verify your phone and add your name and a photo so we can match you to the door list."
              href={`/join?next=${encodeURIComponent(`/g/${token}`)}`}
              cta="Start"
            />
            <Step
              n={2}
              title="Get the SDG app"
              body="Your door QR lives in the app. Faster than pulling this email up in line."
              href="https://apps.apple.com/us/app/id0000000000"
              cta="App Store"
              external
            />
          </ol>

          <p
            className="text-[12px] leading-[1.6]"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            No app? No problem. If you don&rsquo;t finish signup in time, the door will look up your
            name{entry.guest_email ? ` (${entry.guest_email})` : ''} on the list.
          </p>
        </>
      )}
    </main>
  );
}

function Step({ n, title, body, href, cta, external = false }) {
  return (
    <li
      className="rounded-[16px] border p-5"
      style={{
        background: 'rgba(20,20,20,0.55)',
        borderColor: 'rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold"
          style={{
            background: 'rgba(217,196,140,0.14)',
            color: '#d9c48c',
            border: '1px solid rgba(217,196,140,0.35)',
          }}
        >
          {n}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[15px] font-bold mb-1"
            style={{ color: '#f5f5f5', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {title}
          </div>
          <p
            className="text-[13px] leading-[1.55] mb-3"
            style={{ color: 'rgba(255,255,255,0.65)' }}
          >
            {body}
          </p>
          {external ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.16em] transition-transform hover:-translate-y-0.5"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
            >
              {cta.toUpperCase()} →
            </a>
          ) : (
            <Link
              href={href}
              className="inline-block px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.16em] transition-transform hover:-translate-y-0.5"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
            >
              {cta.toUpperCase()} →
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function formatEventDate(iso) {
  if (!iso) return '';
  // event_date is stored as a bare YYYY-MM-DD (no time), so parsing it as a
  // date string alone yields the correct calendar day in America/Chicago.
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
