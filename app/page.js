import Wordmark from './components/Wordmark';
import PortalTile from './components/PortalTile';
import EventsTile from './components/EventsTile';
import SiteFooter from './components/SiteFooter';
import upcomingEvents from '@/lib/upcomingEvents';
import { fetchUpcomingEvents } from '@/lib/tickettailor';

export const revalidate = 300;

export default async function HomePage() {
  // Live data from Ticket Tailor when an API key is configured. Falls
  // back to the static list in lib/upcomingEvents.js for local dev or
  // if the API is unreachable.
  const live = await fetchUpcomingEvents({ limit: 3 });
  const events = live && live.length > 0 ? live : upcomingEvents;

  return (
    <>
      <main className="min-h-[calc(100vh-100px)] flex flex-col">
        {/* Hero wordmark */}
        <section className="flex flex-col items-center px-6 pt-8 md:pt-16 pb-12 md:pb-16">
          <Wordmark size="xl" align="center" />
          <p
            className="mt-6 text-[13px] md:text-[14px] text-center max-w-[460px] leading-[1.6]"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            Underground music venue, cowork space, and creative hub in the
            St. Elmo Arts District.
          </p>
        </section>

        {/* Two portals */}
        <section className="px-6 pb-20">
          <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
