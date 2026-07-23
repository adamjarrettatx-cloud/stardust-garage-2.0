# Financial Calendar Runbook

Operational guide for the owner-only Financial Calendar (MVP). **This file
contains NO secrets — only the names of environment variables and how the
feature is wired up.**

## What it does

- Presents TicketTailor **income by event date** on a month calendar that reuses
  the Team Calendar interaction/visual conventions and the Event Analytics data
  and styling.
- Shows **historical** income (from stored metrics) and **current/live**
  sales-to-date.
- For **upcoming events**, shows **actual sales collected so far**, explicitly
  labeled "sales-to-date (not a forecast)". No projection is applied.
- Tracks **income only**. Expenses are out of scope.

## Route & access control

| Item | Value |
| --- | --- |
| Route | `/bananas/financial-calendar` |
| Nav entry | Admin dashboard → **Analytics** tab → **Financial Calendar** tile (owner-only) |
| Page gate | `ownerPageGate()` (server-side) |
| API used | `POST /api/admin/refresh-event-metrics` (existing, read-only) |

Authorization is enforced **server-side** by `ownerPageGate()` in
`lib/auth-helpers.js`, exactly like `/bananas/analytics`:

1. Must be authenticated (else → `/bananas/login`).
2. Must be an admin per the server-controlled `team_members.role` table — **not**
   editable `user_metadata` (Supabase advisor 0015).
3. Must be the **owner** — the signed-in email from `auth.users`
   (`supabase.auth.getUser()`) must equal `adam@sdgatx.com`. Non-owner admins are
   redirected to `/bananas`.
4. MFA is enforced consistently with other sensitive admin pages: when
   `ENFORCE_ADMIN_MFA=true`, a non-`aal2` session is redirected to
   `/bananas/security`.

The nav tile is hidden for non-owners, but hiding the link is **not** the
security boundary — the server gate is. There is no client-side TicketTailor
access and no API secret is exposed to the browser.

## Data source & refresh

The calendar renders income entries from **two** read-only caches, merged
server-side (`buildFinancialCalendar` in `lib/financial-calendar.js`):

1. **Local events** — `public.event_ticket_metrics`, keyed by local
   `events.id`, populated by `/api/admin/refresh-event-metrics`. Unchanged.
2. **TicketTailor-only events** — `public.tt_discovered_events`, keyed by TT
   event series id, populated by `/api/admin/refresh-tt-discovered`. This
   surfaces historical events that live **only** in TicketTailor and were never
   mirrored onto the website (no `public.events` row) — previously invisible.

Both refresh routes only ever GET from TicketTailor (`listEvents` / `listOrders`
/ `listIssuedTickets`); neither writes back to TicketTailor, and **no website
event record is ever created**. Money is stored/summed in integer cents and
formatted to USD only at render.

### De-duplication
A TT series represented by a local event is served from `event_ticket_metrics`;
the matching `tt_discovered_events` row is skipped (matched by series id, or by
its `local_event_id` back-link) so income is never double-counted. TT-only
entries have no local page — the day-detail panel shows their title as plain
text rather than a link to `/bananas/events/:id`.

### Refresh routes
| Route | Trigger | Auth |
| --- | --- | --- |
| `POST/GET /api/admin/refresh-event-metrics` | Daily cron `23 6 * * *` + **Refresh metrics** button | `CRON_SECRET` / admin+MFA |
| `POST/GET /api/admin/refresh-tt-discovered` | Daily cron `41 6 * * *` | `CRON_SECRET` / admin+MFA |

The discovery route is **batched and resumable**: each run lists all TT
occurrences (one paginated call), upserts their identity (title/date/series),
then pulls income for up to **25** of the stalest not-yet-linked series
(`DEFAULT_BATCH`, clamped to `MAX_BATCH=100`). Never-fetched rows go first, so
successive daily runs cycle through the full catalog without exceeding
serverless time / TT rate limits. Series already covered by a local event are
skipped (the local metrics route owns them).

### Migration
- **`supabase/migrations/20260723_tt_discovered_events.sql`** (additive) creates
  `public.tt_discovered_events` with admin-only RLS reusing `public.is_admin()`.
  It does not alter `public.events` or `public.event_ticket_metrics`.
- The local-events path still requires **no** migration (reuses
  `event_ticket_metrics`).

## One-time deployment & backfill

1. **Apply the migration** (e.g. `supabase db push`, or run the SQL file against
   the project). Purely additive; safe to re-run.
2. **Deploy** so the new route `/api/admin/refresh-tt-discovered` and the daily
   cron entry in `vercel.json` are live.
3. **Backfill now** (don't wait for the cron). As an owner/admin, POST to the
   route to pull income for the discovered TT-only events. A single run with a
   raised batch covers a small historical catalog:
   ```bash
   # Admin session (browser) — or server-to-server with the cron secret:
   curl -X POST https://<host>/api/admin/refresh-tt-discovered \
     -H 'Content-Type: application/json' -d '{"limit": 100}'
   # OR the scheduled path:
   curl https://<host>/api/admin/refresh-tt-discovered \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Re-run until the JSON response reports `"remaining": 0`. The Feb–Apr events
   then appear on the calendar with real income.
4. **Verify**: open `/bananas/financial-calendar`, navigate to February–April;
   TT-only events render (title as plain text, no local link) with income.

### Environment variables (already used by the existing integration)

| Var | Purpose |
| --- | --- |
| `TICKETTAILOR_API_KEY` | Server-side read-only TicketTailor access. Without it, events are shown as "not configured" rather than guessed. |
| `CRON_SECRET` | Authenticates the scheduled refresh (`GET`). |
| `ENFORCE_ADMIN_MFA` | When `true`, requires a stepped-up (aal2) session for admin pages. |

## Per-event states handled

`lib/financial-calendar.js` classifies each event so the UI renders the correct
treatment (never a fabricated number):

- `ok` — refreshed, has real income (green).
- `zero` — refreshed, genuine $0 so far.
- `pending` — TT-linked but never refreshed.
- `unlinked` — no TicketTailor series linked.
- `not_configured` — TT series linked but `TICKETTAILOR_API_KEY` missing.
- `error` — last refresh attempt failed.

## Deferred scope (intentionally NOT built yet)

- **SpotOn CSV import.** Extension point is in place:
  `lib/financial-calendar.js` gives every entry an `incomeSources` array and a
  `mergeIncomeSources()` seam. A future SpotOn importer contributes an object of
  the same shape and the month totals add up with no shape change.
- **Expenses / net profit.** Income only for the MVP.
- **Forecasting / projected revenue.** Upcoming events show actual sales-to-date
  only, deliberately labeled so it is not read as a projection.

## Tests

- `tests/financial-calendar.test.mjs` — pure data helpers: income entry
  building, state classification, future-event flagging, month filtering, and
  income aggregation.
- Run: `npm test`.
