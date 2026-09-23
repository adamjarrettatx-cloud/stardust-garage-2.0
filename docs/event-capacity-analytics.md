# Event Capacity analytics

Admin navigation: ADMIN → Event Capacity (`/bananas/capacity`).
Optional deep link: `/bananas/capacity?event=<event UUID>`.

The dashboard defaults to 5-minute intervals, with an Hourly toggle for the
full-night overview. Capacity bars, arrivals/departures, heatmap, detail table,
and CSV all use the selected interval. Both resolutions aggregate original audit
timestamps, not interpolated hourly totals. API `interval=5|60` selects resolution
(omitting it retains the original 60-minute API default). CSV records
`interval_minutes` with explicit UTC start/end boundaries.

## Data and attribution

This is a read-only report over `capacity_events`, `capacity_sessions`, published
`events`, and the currently open `door_sessions` row. No migration, backfill,
counter mutation, new dependency, or guest-level personal information is needed.

Historical capacity has no event foreign key. Event selection therefore shows
the explicitly labeled, venue-wide operating window for the event date:
9am to 9am in America/Chicago. This is not event-exclusive or unique attendance.
Multiple published events on one date lead to a shared-night view rather than
duplicating totals under separate events. Unlinked operating nights remain
selectable, and older multi-day sessions are split into daily windows.

Hourly peaks include the opening carried count. Entries and exits sum recorded
check-in/check-out deltas, not ticket sales. Resets and manual adjustments are
separate corrections, never departures. Closing a session does not imply zero
occupancy. Missing exits cannot be recovered. Counts do not carry across gaps in
session coverage. Unknown counts remain unavailable rather than becoming zero.
Same-timestamp changes with different resulting counts flag ordering ambiguity.

Automatic 9am rollover timestamps can lag the boundary by milliseconds.
Session boundaries and start anchors within one second of 9am are normalized
for reporting only, preventing the prior night's leftover count from creating a
false new-night peak. Source records are not modified.

DST windows contain 23 or 25 hours where applicable. Local labels include
CDT/CST, and CSV includes both UTC boundaries and local labels.

## Live behavior and security

The API (`GET /api/admin/capacity-analytics`) independently requires admin MFA
before constructing the service-role client. The page uses the existing admin
page gate. Responses are private and not cached.

Live and current-night views refresh every 15 seconds. Failed polling retains
previous values with a stale-data warning; values older than 45 seconds also
show stale status. Switching selections aborts the previous request and clears
its report. A stale door session is never used to attribute another night's
count. The live count is sampled from the active capacity session and may differ
briefly from the separately read audit history during concurrent door activity.

Queries use stable time/ID ordering, a server-time upper boundary, and explicit
500-row pagination. Query failures or the 100,000-row safety limit fail closed
instead of silently displaying partial history. Audit-row fields exclude actor
IDs, device identifiers, and notes. Seed rows establish carry-in for sessions
that began before the selected operating window.

## QA and rollout

Automated coverage includes date validation, overnight/DST boundaries, gaps,
carry-in, corrections, rollover jitter, unknown anchors, timestamp ties,
shared-date attribution, full-history pagination, CSV escaping, navigation,
and API authorization/MFA. Run `npm test` and targeted ESLint before merge.

Browser checks cover the actual production React component in an isolated
snapshot harness: chart modes, hourly selection, full-window toggle, CSV,
event selection, future/shared-date states, live polling and failure recovery,
mobile overflow, and light/dark themes. Fixtures and fetch interception are
outside the production repository and must never be shipped in the Next app.

Real September 18, 2026 audit rows reconcile to 322 entry operations, 207 exit
operations, peak 197, and final recorded count 115. The page warns that this
nonzero closeout cannot establish how many people remained in the venue.

Rollout uses the normal reviewed GitHub PR and Vercel deployment. No Supabase
migration or environment-variable change is required.
