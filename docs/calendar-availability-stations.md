# Calendar Availability stations

## Scope

Shared username/password accounts with the `calendar_availability` role can view only a date-level availability calendar. They cannot see titles, artists, event IDs, times, categories, visibility, notes, contracts, contacts, guest lists, counts, or reasons a date is blocked. They cannot reserve, edit, or create anything.

An internal event is a tentative hold and blocks the date. Every stored entry in `events` or `team_events` blocks its entire `event_date`, including draft, unpublished, unlisted, and public events. Duplicate entries collapse into the same unavailable date. This mirrors the internal calendar's date placement; it does not infer overnight spillover or future occurrences not yet materialized in the calendar.

## Security boundary

- Existing opaque HttpOnly/Secure/host-only station cookies, password authentication, rate limits, 12-hour sessions, owner MFA controls, and revocation apply unchanged.
- No `team_members` row or personal `calendar_viewer` role is granted.
- Exact role allowlist: `GET /staff/availability`, `GET /api/station/availability`, `GET /api/station/session`, and `POST /api/station/logout`; the page also allows HEAD.
- Login/logout remain available for session switching. Static assets and public informational pages remain public; no other backend workspace or API is granted.
- The existing door-session metadata endpoint is explicitly limited to Security/Front Desk, not shared by Calendar Availability.
- Middleware, the server page, the endpoint, and the service-only SQL function enforce the role independently. Database resolution rechecks current account/session status.
- SQL returns exactly 365 consecutive date strings and availability booleans starting today in America/Chicago, with no caller-selected range.
- The API validates and projects that result, discarding any unexpected fields. All errors fail closed with generic messages and no-store caching.
- The browser receives no full event data. Failed refresh removes the calendar rather than showing stale availability. Refresh runs every minute and on focus.
- The standalone workspace has no backend navigation. Public navbar, sound toggle, and initial Mailchimp loading/attribution are excluded on staff routes.

## Release

Migration: `20260930220000_station_calendar_availability.sql`. Apply before deploying the corresponding application changes. This expands the station role constraint and creates one service-only read function; it does not create accounts or modify event data.

Owner flow after release: Team access → Manage stations → Create station → Calendar Availability. Save the generated password once. The account signs in at `/staff/login` and lands at `/staff/availability`. Existing Security/Front Desk accounts keep their current roles.

The role is a predefined permission bundle, not an arbitrary custom-role editor. Separate accounts per promoter/booker organization are recommended so access can be revoked independently.

## Verification

`npm run test:stations` covers role isolation, login landing, owner creation, sanitized output, invalid data, internal/draft/team holds, duplicate dates, the Chicago date range, service-only execution, and disabled-session rejection. `npm test` covers the broader suite. Browser preview QA uses the real React components with clearly synthetic data, not production event data.

Production migration, deployment and a positive real-account acceptance test require separate release approval. A local build or synthetic preview is not proof of production availability.
