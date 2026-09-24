import Link from 'next/link';
export default function EventList({ events: data, error = false }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  return <main className="my-events">
    <Link className="event-back" href="/account/profile">Back to profile</Link>
    <h1>My Events</h1>
    <p className="event-intro">Your assigned events, with ticket sales available during and after each event.</p>
    {error ? <p role="alert">Events could not be loaded. Refresh to try again.</p> : !data?.length ? <div className="event-empty">No events assigned yet. Your events will appear here when the Stardust Garage team adds your organization.</div> :
      [['Upcoming events', data.filter((e) => e.event_date >= today)], ['Past events', data.filter((e) => e.event_date < today)]].map(([heading, events]) => events.length > 0 && <section key={heading}>
        <h2>{heading}</h2>
        <div className="event-grid">{events.map((event) => <Link className="event-card" key={event.id} href={`/portal/events/${event.id}`}>
          {event.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={event.image_url} alt="" /> : <div className="event-art-fallback" aria-hidden="true">SDG</div>}
          <div><p className="event-date">{event.event_date} {event.event_time || ''}</p><h3>{event.title}</h3><p>{event.status === 'cancelled' ? 'Cancelled · View sales' : 'View ticket sales'}</p></div>
        </Link>)}</div>
      </section>)}
  </main>;
}
