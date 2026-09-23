# Artist Pay: manual Mercury onboarding

## Scope

Artists are created directly in Mercury. SDG stores only a Mercury recipient UUID, linkage attribution, and payment-request references. There is no recipient API lookup, recipient invitation, bank-details form, banking-document upload, or last-four storage in this feature.

SDG review approval remains independent of the W-9 gate. The owner explicitly queues an approved request after checking its recipient and amount. Mercury approval remains a separate action outside SDG.

This release tracks Mercury approval requests, not settlement. A Mercury `approved` status is shown as “Approved in Mercury - settlement not verified.” Neither bookings nor pay requests are marked `paid`. Until settlement reconciliation ships, Mercury remains the payment ledger and the SDG 1099 view is incomplete.

## Owner workflow

1. Create the payee directly in Mercury and configure ACH there.
2. Obtain the recipient UUID from Mercury. If the dashboard does not expose it, stop and verify the supported way to obtain it with Mercury; do not substitute a bank account number or guess an identifier.
3. Open the contact in SDG and save the UUID under **Mercury payout profile**. Confirm that the Mercury recipient is the intended artist/legal payee and is ready for ACH.
4. Review and approve the artist's pay request in SDG.
5. Ensure the existing protected W-9 workflow shows `w9_on_file = true`.
6. Use **Queue in Mercury** and review the exact recipient UUID and amount before confirming.
7. Approve the request directly in Mercury. Use **Refresh Mercury status** to update the approval state in SDG.
8. Verify payment settlement and retain payment/tax records in Mercury. Do not interpret the SDG approval display as proof of payment.

Recipients are linked manually rather than verified through `/recipients` or `/recipient/{id}` because those endpoints can return routing/account data ([Mercury recipient schema](https://docs.mercury.com/reference/getrecipient.md)).

## Security and recovery

- Owner + existing MFA policy for every payout read/write route; same-origin checks for mutations.
- No recipient or direct-send API calls. Payouts use only `POST /account/{accountId}/request-send-money` and `GET /request-send-money/{requestId}`. The owner-triggered read-only setup check additionally uses `GET /accounts`, returning only the selected source account's UUID, display names, and status, never balances or banking numbers.
- Exact body allowlists reject additional fields, including banking details.
- Service-role-only payout tables and RPCs; no anonymous/authenticated table access or RPC execution.
- Recipient, source account, environment, amount, and idempotency key are snapshotted before the network request.
- A database lease serializes queue/refresh operations. The confirmation is checked against the authoritative snapshot.
- Unknown network outcomes retain the same snapshot and key. Wait for the two-minute lease if a worker died; reconcile Mercury before retrying.
- A known Mercury request is never re-created, including after rejection/cancellation.
- Changing a recipient is blocked while any unresolved or Mercury-approved payout exists. Settlement/relink reconciliation is intentionally not exposed yet.
- Saving result and audit entries is transactional. Provider response bodies and tokens are not logged or stored.
- Explicit anonymous revocation and deterministic request ordering are added to `partner_bookings()` without changing its existing optional-slot/hour behavior.

Mercury documents idempotency keys and approval-required payments; the integration never falls back to immediate send ([Mercury request endpoint](https://docs.mercury.com/reference/requestsendmoney.md), [implementation guidance](https://docs.mercury.com/reference/createtransaction), [payment workflow](https://docs.mercury.com/docs/send-money)).

## Deployment gates

Do not enable live queueing just because this pull request is merged.

### Selected production account

Adam selected **Artist & Collective Pay**, a Checking account ending **0305**, on September 23, 2026. He supplied its dashboard URL, `https://app.mercury.com/accounts/depository/6a8a713e-b760-11f1-a161-6b9575e7cd6d`, identifying the intended account UUID. This is a dashboard-derived selection, not yet an authenticated API verification.

Non-secret production configuration:

```text
MERCURY_ENVIRONMENT=production
MERCURY_ACCOUNT_ID=6a8a713e-b760-11f1-a161-6b9575e7cd6d
ARTIST_PAY_MERCURY_ENABLED=false
```

`MERCURY_API_KEY` must be entered into the deployment's protected server-side environment. It is not committed to this repository. Saving a credential in Computer's vault does not automatically install it in Vercel.

The owner-only **Check Mercury connection** control performs `GET /accounts` from the deployed server and returns only the selected account's UUID, display names, and status. It works while queueing is disabled and avoids the local development environment's credential-proxy certificate issue. It never calls recipient endpoints or creates a payment. A successful result does not establish payment scope or self-approval eligibility.

### Release checklist

1. Review and apply `20260922110000_artist_pay_manual_mercury.sql` before enabling the feature. The migration is additive except for removing authenticated audit insertion and tightening anonymous function access.
2. Deploy the application with `ARTIST_PAY_MERCURY_ENABLED` absent or `false`.
3. Configure server-side variables only:
   - `MERCURY_ENVIRONMENT`: `sandbox` or `production`; no arbitrary API host.
   - `MERCURY_API_KEY`: scoped Mercury API token, never a `NEXT_PUBLIC_` variable.
   - `MERCURY_ACCOUNT_ID`: Mercury source-account UUID, not a bank account number.
   - `ARTIST_PAY_MERCURY_ENABLED`: set to exact `true` only after the checks below.
   - Vercel preview/development deployments fail closed if `MERCURY_ENVIRONMENT=production`, even if the enable flag is accidentally inherited.
4. Use a Custom token limited to **Send Money with Approval**, **Fetch Send Money Requests**, and **Fetch Depository Accounts** (the last is used solely by the read-only connection check). This implementation does not require Fetch Recipients, Create Recipients, recipient invites, or direct Send Money.
5. Verify who can approve API-created requests in this Mercury organization. The endpoint reference says the approver must differ from the token creator; the newer guide documents a policy-dependent self-approval exception. Do not assume a sole-user account qualifies. Confirm the actual account policy with Mercury before activation ([endpoint reference](https://docs.mercury.com/reference/requestsendmoney), [current guide](https://docs.mercury.com/docs/send-money)).
6. Use an isolated test database and sandbox token/recipients for end-to-end testing. Do not create sandbox payout snapshots in production; changing environments later intentionally blocks reuse.
7. Sandbox checks: queue once, double-click/retry, verify pending request in Mercury, approve/reject there, refresh, remove W9 and verify send blocked, simulate response-save failure, verify no banking data in SDG logs/DB.
8. For production, use one explicitly authorized real pay request as the first live test. Do not create a test payment without a real payee/amount approved by the owner.

Sandbox tokens and the production token are not interchangeable ([Mercury sandbox guide](https://docs.mercury.com/docs/using-mercury-sandbox)).

## Validation

- `npm run test:artist-pay`: provider boundary, route authorization, payload validation, unknown-outcome recovery, actual PostgreSQL RPC/constraints/privileges using PGlite.
- `npm test`: existing regression suite.
- `npm run build`: production compilation.
- Visual QA: manual recipient link, approval, explicit queue confirmation, W9 and unlinked-recipient blocks, disabled integration, unknown submission, Mercury rejection, status refresh, profile loading error, desktop/mobile and light/dark layouts.

## Deferred work

- Mercury settlement/reversal reconciliation and payment-date-based tax totals.
- Safe replacement attempts after cancellation/rejection and controlled recipient relinking after completed payouts.
- Self-service Mercury recipient onboarding.
- Automatic polling/webhooks, bulk payout queueing, wires, and international payments.
