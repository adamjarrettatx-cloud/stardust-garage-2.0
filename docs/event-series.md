# Event series

A recurring event is an `event_series` plus independent `events` rows. Each row is one real occurrence, so tickets, orders, check-ins, and financial metrics never roll into another week. `events.series_id` links an occurrence to its series; `recurrence_position` gives its sequence number.

## Creating a recurring event

Create the first event normally, then choose Weekly or Bi-weekly in the Recurrence section. The selected first-occurrence date establishes the weekday. Saving creates the series and makes that event its template. Edit an occurrence normally for a one-off change; those changes do not propagate to other weeks.

## Generation

`/api/cron/generate-series-occurrences` runs daily at 06:30 UTC. When the latest occurrence reaches its date, it creates one next occurrence as `draft`, cloning the template event and its ticket products, price tiers, and inventory capacity. It never publishes generated events. `series_generation_log` records each generated occurrence.

## Financial rollup

`/bananas/series/[id]` sums the cached `event_ticket_metrics` rows across all occurrences. The table remains per-event; the rollup is a macro view only.
