import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Capacity Counter' };

function Tile({ href, eyebrow, title, desc, color }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl p-6 border transition-colors hover:border-white/25"
      style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <div className="text-[11px] font-semibold tracking-[0.16em] mb-2" style={{ color: color || '#8a8a8a' }}>{eyebrow}</div>
      <div className="text-[20px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</div>
      <div className="text-[13px]" style={{ color: '#8a8a8a' }}>{desc}</div>
    </Link>
  );
}

export default async function CapacityHub() {
  const { unauthorized, isAdmin } = await requireTeam();
  if (unauthorized) redirect('/team/login');

  return (
    <main className="max-w-[760px] mx-auto px-6 py-16">
      <h1 className="text-[34px] font-extrabold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Capacity Counter
      </h1>
      <p className="text-[14px] mb-10" style={{ color: '#8a8a8a' }}>
        Open the right page on each device. Counts stay in sync in real time.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Tile href="/capacity/front-desk" eyebrow="LAPTOP · FRONT DESK" title="Front Desk" desc="Live capacity, guest list check-in, issue a trial pass" color="#c084fc" />
        <Tile href="/capacity/scan" eyebrow="IPAD · SCAN" title="Scan Trial Pass" desc="Camera scanner for the Trial SDG Pass QR — auto-bumps capacity" color="#7CFC9B" />
        <Tile href="/capacity/front-door" eyebrow="JELLY2 · FRONT" title="Front Door" desc="Big green check-in button" color="#7CFC9B" />
        <Tile href="/capacity/exit-door" eyebrow="JELLY2 · EXIT" title="Exit Door" desc="Big red check-out button" color="#ff8a8a" />
        <Tile href="/capacity/guest-list" eyebrow="TABLET · GUEST LIST" title="Guest List" desc="Find a name, check them in, mark no-shows" color="#8ab4ff" />
        {isAdmin && (
          <Tile href="/capacity/admin" eyebrow="ADMIN" title="Setup & History" desc="Start/end session, set max, reset, audit log" color="#ffb84d" />
        )}
      </div>
    </main>
  );
}
