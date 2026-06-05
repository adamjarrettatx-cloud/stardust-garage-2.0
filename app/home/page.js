import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import Wordmark from '../components/Wordmark';
import PortalTile from '../components/PortalTile';
import EventsTile from '../components/EventsTile';
import SiteFooter from '../components/SiteFooter';

export const revalidate = 0;

export default async function HomePage() {
  const supabase = await createClient();
  const { data: allEvents } = await supabase.from('events').select('*').order('event_date', { ascending: true });

  const today = new Date();
  const todayInAustin = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
  const todayDate = new Date(todayInAustin + 'T00:00:00');

  const events = (allEvents || []).filter((e) => new Date(e.event_date + 'T00:00:00') >= todayDate).slice(0, 3);

  return (
    <>
      <main className="min-h-[calc(100vh-100px)] flex flex-col">
        <section className="flex flex-col items-center px-6 pt-8 md:pt-16 pb-12 md:pb-16">
          <Wordmark size="xl" align="center" />
          <p className="mt-6 text-[13px] md:text-[14px] text-center max-w-[460px] leading-[1.6]" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Underground music venue, cowork space, and creative hub in the St. Elmo Arts District.
          </p>
        </section>

        <section className="px-6 pb-20">
          <div className="max-w-[1100px] mx-auto space-y-6">
            {/* Two main portals side-by-side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <EventsTile events={events} />
              <PortalTile
                href="/members"
                transitionName="portal-members"
                eyebrow="JOIN"
                title="Membership"
                summary="A small, curated cowork in the St. Elmo Arts District. The kind of room you actually want to be in all day."
                bullets={[
                  'Gigabit fiber internet, deep focus',
                  'Healthy refreshments stocked daily',
                  'Members and approved guests only',
                ]}
                cta="VIEW PLANS"
                tint="radial-gradient(120% 80% at 50% 0%, rgba(180,135,70,0.55) 0%, rgba(40,28,18,0.95) 55%, rgba(14,10,8,1) 100%)"
              />
            </div>

            {/* Studio full-width banner */}
            <Link
              href="/members"
              className="group relative block overflow-hidden rounded-[18px] border transition-all hover:-translate-y-0.5 hover:border-white/15"
              style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <div
                className="absolute inset-0"
                style={{ background: 'radial-gradient(120% 200% at 50% 50%, rgba(70,130,180,0.45) 0%, rgba(18,28,40,0.95) 55%, rgba(8,10,14,1) 100%)' }}
              />
              <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6 px-7 md:px-10 py-7 md:py-8">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold tracking-[0.28em] mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    CREATE
                  </div>
                  <h2 className="text-[26px] md:text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    Studio
                  </h2>
                  <p className="text-[14px] md:text-[15px] max-w-[640px] leading-[1.55]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    A pro-grade studio space inside Stardust Garage — for production, rehearsal, and recording sessions. Bookable hourly by active members.
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[11px] font-semibold tracking-[0.16em] transition-all group-hover:bg-white" style={{ background: 'rgba(255,255,255,0.95)', color: '#0a0a0a' }}>
                    LEARN MORE
                    <span aria-hidden style={{ transition: 'transform 0.2s' }} className="group-hover:translate-x-0.5">→</span>
                  </span>
                </div>
              </div>
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
