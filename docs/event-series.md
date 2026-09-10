# Event series

A recurring event is an `event_series` plus independent `events` rows. Each row is one real occurrence, so tickets, orders, check-ins, and financial metrics never roll into another week. `events.series_id` links an occurrence to its series; `recurrence_position` gives its sequence number.

## Creating a recurring event

Create the first event normally, then choose Weekly or Bi-weekly in the Recurrence section. The selected first-occurrence date establishes the weekday. Saving creates the series and makes that event its template. Edit an occurrence normally for a one-off change; those changes do not propagate to other weeks.

## Generation

The next draft is created immediately when an occurrence is published, rather than overnight. It clones the canonical template event and its ticket products, price tiers, and inventory capacity; `series_generation_log` records every generated occurrence. `/api/cron/generate-series-occurrences` still runs daily at 06:30 UTC as an idempotent safety net.

`/api/cron/publish-due-series-drafts` runs every five minutes. It auto-publishes a draft only once its immediately preceding occurrence has ended according to `computeEventListingCutoff` — the same rule public listings use to hide a finished event. It uses the America/Chicago date-only end-of-day fallback when times cannot be parsed, never publishes position 1, ignores inactive series, and has a safety cap of five publication attempts per run.

For already-existing active series, an admin can run `POST /api/admin/series/backfill-next-drafts` once after deployment. The MFA-gated endpoint uses the same generation helper and is safe to run again; it creates at most the next draft after each latest published occurrence.

## Financial rollup

`/bananas/series/[id]` sums the cached `event_ticket_metrics` rows across all occurrences. The table remains per-event; the rollup is a macro view only.
