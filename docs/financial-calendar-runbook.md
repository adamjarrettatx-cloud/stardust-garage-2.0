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

The calendar renders income entries from **three** sources, merged
server-side (`buildFinancialCalendar` in `lib/financial-calendar.js`):

1. **Local events** — `public.event_ticket_metrics`, keyed by local
   `events.id`, populated by `/api/admin/refresh-event-metrics`. Unchanged.
2. **TicketTailor-only events** — `public.tt_discovered_events`, keyed by TT
   event series id, populated by `/api/admin/refresh-tt-discovered`. This
   surfaces historical events that live **only** in TicketTailor and were never
   mirrored onto the website (no `public.events` row) — previously invisible.
3. **Manual income** — `public.manual_income_entries`, keyed by its own uuid,
   entered by the **owner** through the calendar UI. Covers income with no
   TicketTailor record (e.g. a venue rental paid directly). A manual entry is
   either **standalone** (no local event) OR **linked to an existing local
   event** via `local_event_id` — e.g. a group rents the venue for an event
   that also has (or lacks) ticket sales. Read-only sources (1) and (2) are
   never mutated by this path.

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

### Manual income (owner-entered)
The owner records income by hand from the calendar two ways:

- **Standalone** — the top-level **+ Add income** button, for money with no
  event at all.
- **Linked to an existing event** — the **+ Add income to event** button inside
  a local event's day-detail card. The form opens prefilled with the event's
  date/title context and a `venue_rental` category; a **Customer / group** field
  captures who paid (e.g. SolarPunk). The saved entry carries the event's
  `local_event_id`.

Both use Edit/Delete on the entry's day-detail card. Deleting removes only the
manual income row — never the event. These rows are:

- **Owner-only, stricter than admin.** Reads and writes are gated by
  `requireOwner()` (server-side owner email from `auth.users`) at the API, and
  by RLS policies using a new `public.is_owner()` definer function at the DB.
  A non-owner admin/team member can neither see nor modify manual income.
- **Linked safely.** `local_event_id` is never trusted from the client: the
  write route fetches the candidate row from `public.events` server-side and
  `checkEventLink()` rejects the save (422) if it does not resolve to a real
  event. Editing preserves the link unless the entry is intentionally saved as
  standalone.
- **Never double-counted.** A **linked** entry is folded into its parent event
  (`attachManualIncomeToEvent`): its money rolls into the parent's *combined*
  gross and it is **not** also rendered as a separate day entry, so month totals
  count it exactly once (through the parent). A **standalone** entry is its own
  uuid-keyed entry and adds on top. Either way `summarizeIncome` sums each
  amount once; manual rows carry no tickets/orders. A linked entry whose event
  is missing from the dataset falls back to standalone so money is never lost.
- **Combined breakdown.** A linked event's day-detail card shows the combined
  total plus a breakdown (TicketTailor income + manual income) and lists each
  manual line with source, category, customer/group, amount, and Edit/Delete.
  An event with **no TT link** shows its manual income instead of only
  "No TT link" once income is added.
- **Money-safe.** The UI accepts `$`, thousands commas, and up to 2 decimals;
  `parseAmountToCents()` converts to integer cents without float error and
  rejects negative/over-precise input. Server re-validates via
  `validateManualEntry()` — the client is never trusted.
- **CSRF-guarded.** The write route additionally checks same-origin
  (`isSameOrigin`) on top of the owner session + SameSite cookies.

| Endpoint | Method | Purpose | Auth |
| --- | --- | --- | --- |
| `/api/admin/manual-income` | `POST` | Create a manual income entry | `requireOwner()` + same-origin |
| `/api/admin/manual-income` | `PATCH` | Edit an entry by id | `requireOwner()` + same-origin |
| `/api/admin/manual-income` | `DELETE` | Delete an entry by id | `requireOwner()` + same-origin |

Categories live in `lib/manual-income.js` (`MANUAL_CATEGORIES`) as a
convention — the DB stores `category` as text (not a Postgres enum) so new
categories need **no migration**. `venue_rental` is the default; `other` is the
escape hatch.

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

### Migrations
- **`supabase/migrations/20260723_tt_discovered_events.sql`** (additive) creates
  `public.tt_discovered_events` with admin-only RLS reusing `public.is_admin()`.
  It does not alter `public.events` or `public.event_ticket_metrics`.
- **`supabase/migrations/20260723_manual_income_entries.sql`** (additive) creates
  the `public.is_owner()` definer function and `public.manual_income_entries`
  with **owner-only** RLS. It does not alter any existing table or function.
- The local-events path still requires **no** migration (reuses
  `event_ticket_metrics`).

## One-time deployment & backfill

Apply migrations in either order — both are independent and additive.

1. **Apply the migrations** (e.g. `supabase db push`, or run the SQL files
   against the project). Purely additive; safe to re-run.
   - `20260723_tt_discovered_events.sql`
   - `20260723_manual_income_entries.sql`
2. **Deploy** so the routes `/api/admin/refresh-tt-discovered` and
   `/api/admin/manual-income`, plus the daily cron entry in `vercel.json`, are
   live.
3. **Backfill TicketTailor-only events** (don't wait for the cron). As an
   owner/admin, POST to the discovery route to pull income for TT-only events:
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
4. **Manual income needs NO backfill** — it is entered on demand. There is no
   seed data. After deploy, the owner adds entries via **+ Add income**. (The
   motivating SolarPunk venue rental on 2026-07-18 for $2,800.00 is intentionally
   NOT seeded — create it only after confirming.)
5. **Verify**: open `/bananas/financial-calendar`; navigate to February–April
   for TT-only events; add a manual entry and confirm it appears tagged
   **Manual** and rolls into the month total.

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

Manual entries are always `ok` (real, countable money) and additionally flagged
`isManual` so the UI tags them **Manual** and shows Edit/Delete.

## Deferred scope (intentionally NOT built yet)

- **SpotOn CSV import.** Extension point is intact: `lib/financial-calendar.js`
  gives every entry an `incomeSources` array and a `mergeIncomeSources()` seam.
  A future SpotOn importer is a **separate source** contributing an object of the
  same shape — it does NOT reuse `manual_income_entries` or the manual helpers.
  Month totals add up with no shape change.
- **Expenses / net profit.** Income only for the MVP.
- **Forecasting / projected revenue.** Upcoming events show actual sales-to-date
  only, deliberately labeled so it is not read as a projection.

## Tests

- `tests/financial-calendar.test.mjs` — pure data helpers: income entry
  building, state classification, future-event flagging, month filtering, and
  income aggregation (incl. TicketTailor-only + manual merges).
- `tests/tt-discovered-events.test.mjs` — TicketTailor discovery normalization,
  series collapsing, metric/identity builders, and batch selection.
- `tests/manual-income.test.mjs` — cents parsing/validation, create/update
  payload builders, manual calendar-entry shape, date/month aggregation, mixed
  TicketTailor + manual totals (no double-count), the same-origin CSRF guard,
  and event-linked income: `checkEventLink` existence validation, folding a
  linked entry into its parent (dedup), combined TT+manual totals counted once,
  manual-only (no-TT-link) events, standalone/orphan fallback, and edit/delete
  link preservation.
- Run: `npm test`.
