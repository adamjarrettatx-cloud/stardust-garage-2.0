/**
 * Upcoming shows shown on the homepage tile.
 *
 * Source of truth for ticketing is Ticket Tailor:
 *   https://www.tickettailor.com/events/stardustgarageatx
 *
 * When you add or remove an event in Ticket Tailor, update this list to
 * match. Keep it short — the homepage shows up to ~3 entries.
 *
 * Fields:
 *   - id          stable string, anything unique
 *   - title       shown on the tile
 *   - event_date  YYYY-MM-DD (used for the big date numerals)
 *   - ticket_url  the Ticket Tailor event page (or `null` for private/members)
 */
const upcomingEvents = [
  {
    id: 'tt-2184226',
    title: 'Stardust Garage: Saturday Afters',
    event_date: '2026-04-25',
    ticket_url: 'https://www.tickettailor.com/events/stardustgarageatx/2184226',
  },
  {
    id: 'tt-2166744',
    title: 'SAYLESS & Friends at Stardust Garage',
    event_date: '2026-05-08',
    ticket_url: 'https://www.tickettailor.com/events/stardustgarageatx/2166744',
  },
  {
    id: 'tt-2164456',
    title: 'Disco Nova at Stardust Garage',
    event_date: '2026-05-09',
    ticket_url: 'https://www.tickettailor.com/events/stardustgarageatx/2164456',
  },
];

export default upcomingEvents;
