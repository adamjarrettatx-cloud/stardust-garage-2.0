# Ticket order refunds

## Admin workflow

- Open **Orders & Refunds** in the MONEY sidebar, or **Attendees & Orders** on an event.
- Search by purchaser name, email, order ID, or event title. The all-events view also has an event filter.
- Use **Refund** on a row for a full remaining-balance refund or an individual partial USD refund.
- Select individual orders, the current page, or all matching refundable orders for full remaining-balance batch refunds. Maximum: 100 orders. Changing search/filter/view clears selection.
- Enter a reason, review every included/skipped order and the currency-specific totals, then explicitly confirm.
- Keep the window open during batch submission. Each order is submitted independently; a browser interruption does not imply all selected orders were processed.
- Use **Recent refund activity** to check submitted requests after closing or reloading. Unsubmitted orders remain unchanged and can be selected again.

## Payment and admission behavior

- Full refunds include the full remaining captured order amount, including tax and booking fees. This is not a promise that Stripe returns the processing fee to the venue.
- Partial refunds are monetary adjustments, not per-ticket cancellations.
- A successful full refund invalidates still-valid tickets. Used tickets retain their check-in history.
- Pending refunds are shown as pending and do not yet change refunded totals or invalidate tickets.
- Late provider failures reverse the request's applied accounting delta. Tickets already invalidated are not automatically reinstated; an operator must deliberately resolve admission.
- Complimentary/no-payment orders and fully refunded orders cannot be refunded.
- The workflow covers first-party SDG ticket orders only, not Ticket Tailor or memberships.
- If Stripe and local refunded balances differ, or the payment is disputed, execution stops for manual reconciliation rather than issuing an unverified refund.

## Safety model

- Admin-only page/API gates; service-role-only ledger/RPC access; no public ledger policies.
- A review creates draft request records but never calls Stripe.
- The review expires after 15 minutes. Execution locks the order, verifies the reviewed balance, and prevents another active request for the same order.
- Each submitted request holds a 90-second execution lease. The same durable request UUID is also the Stripe idempotency key.
- An uncertain response stays unresolved. Retrying first searches Stripe for that request; it does not invent another ID.
- After 23 hours, an unresolved request can be reconciled but is never newly submitted. Stripe may prune idempotency keys after 24 hours ([Stripe idempotency documentation](https://docs.stripe.com/api/idempotent_requests)).
- The SQL finalizer applies only the difference from `applied_cents`, making replays and late failures accounting-safe. Request, settlement, and failure transitions are audited.
- Refund webhooks fetch current provider state, not stale event payload state. Errors leave the ingest record retryable.
- An hourly read-only-at-Stripe reconciliation checks up to 25 least-recently-checked requests, including recent successes for 35 days. It never creates refunds. Stripe documents pending refunds and late failure events in its [refund guide](https://docs.stripe.com/refunds).
- Legacy unreviewed refund POSTs are refused. The old console sends admins into the reviewed workflow.

## Deployment

1. Apply `supabase/migrations/20260923_ticket_refund_requests.sql` before deploying this code.
2. Deploy the matching application commit. Preserve existing Stripe/Supabase credentials and `CRON_SECRET`.
3. Ensure the Stripe endpoint subscribes to `refund.created`, `refund.updated`, and `refund.failed` for timely updates. The hourly reconciliation is the fallback.
4. Check that anonymous reads/writes are rejected and the admin view loads the real ledger.
5. Validate a Stripe test-mode refund separately, or use an explicitly approved low-value live order. Do not issue real refunds just to test deployment.

No production migration or live refund is performed by the local test suite or the sample-data preview.
