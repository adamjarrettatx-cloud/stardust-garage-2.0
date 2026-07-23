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

- Reads the existing cache table `public.event_ticket_metrics`, populated by the
  read-only refresh route `/api/admin/refresh-event-metrics`:
  - Daily via Vercel cron (`GET`, `Bearer ${CRON_SECRET}`).
  - On demand via the **Refresh metrics** button (`POST`, admin + MFA-ready).
- The refresh route only ever GETs from TicketTailor (`listOrders` /
  `listIssuedTickets`); it never writes back to TicketTailor.
- Money is stored/summed in integer cents and formatted to USD only at render.
- **No new migration is required** — the calendar reuses the existing
  `event_ticket_metrics` columns (`gross_cents`, `net_cents`, `fees_cents`,
  `tickets_sold`, `orders_count`, `status`, `fetched_at`).

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
