# SignNow Integration Runbook

Operational guide for configuring, deploying, and verifying the SignNow
e-signature integration on Vercel. **This file contains NO secrets — only the
names of the environment variables and the steps to wire them up.**

## What the integration does

- Send a contract document (latest version) for e-signature from the admin
  document detail page (`Send via SignNow`).
- Pull current signature status on demand (`Check status`) and reconcile the
  local `document_contracts.status` (forward-only state machine).
- Receive **inbound webhook** events from SignNow to update status automatically
  (no manual polling needed).
- **Archive the signed PDF** back into the private document hub as a new version
  once the contract is fully signed (idempotent — never duplicates).

All admin paths are gated by `requireAdminMfa()`. The webhook is the only
unauthenticated path; it authenticates by HMAC signature instead (see below).

## Environment variables (set in Vercel → Project → Settings → Environment Variables)

Add these **server-side** (do NOT use the `NEXT_PUBLIC_` prefix — that would leak
them to the browser bundle).

| Var | Required | Purpose |
| --- | --- | --- |
| `SIGNNOW_API_KEY` | **Yes** | OAuth2 bearer access token. The only var required for `isSignNowConfigured()` to report true. Rotate ~monthly. |
| `SIGNNOW_API_BASE_URL` | No | Defaults to `https://api.signnow.com`. Override only for a sandbox/region endpoint. |
| `SIGNNOW_BASIC_TOKEN` | No | `base64(client_id:client_secret)`. Enables the SSO-friendly refresh-token grant so the bearer can be minted without a stored password. |
| `SIGNNOW_REFRESH_TOKEN` | No | OAuth2 refresh token (obtained once via the authorization_code flow; works with Google SSO). Pairs with `SIGNNOW_BASIC_TOKEN`. |
| `SIGNNOW_SENDER_EMAIL` | No | "From" email used on signing invites. |
| `SIGNNOW_WEBHOOK_SECRET` | **Yes (for webhooks)** | Shared secret used to verify inbound webhook signatures (HMAC-SHA256). Without it, the webhook **fails closed** and rejects every request. |

> The integration is dark-launch safe: with **no** vars set, every network path
> short-circuits with a clear `SignNowNotConfiguredError` and the build stays
> green. The UI shows "not configured" and admins advance status manually.

## Webhook configuration

1. Deploy this branch so the route exists in production.
2. The inbound webhook URL is:

   ```
   https://<your-domain>/api/webhooks/signnow
   ```

3. In the SignNow dashboard (or via their webhook/subscription API), register a
   webhook subscription that POSTs document events (e.g. `document.complete`,
   `document.update`, decline/expire events) to that URL.
4. Configure the webhook to sign the request body with the same secret you put
   in `SIGNNOW_WEBHOOK_SECRET`. The handler recomputes
   `HMAC-SHA256(rawBody, SIGNNOW_WEBHOOK_SECRET)` and constant-time compares it
   against the signature header.

   **Signature header — verify in live QA.** SignNow's exact header name and
   digest encoding are account/version dependent, so the handler is tolerant:
   - **Header name** — it reads the first present of (in order):
     `x-signnow-signature`, `signnow-signature`, `x-signature`, `signature`.
     If SignNow uses a different name, the request is rejected (fail closed). On
     rejection the handler logs the header *name* it read (never the value) so a
     name mismatch is diagnosable from logs.
   - **Digest encoding** — it accepts the digest as **base64**, **base64url**, or
     **hex**, with an optional `sha256=` / `sha-256=` / `v1=` prefix (and
     surrounding whitespace). You do **not** need to match one exact encoding.
   - To confirm the real format during QA, send one test event and check the
     server logs: a success means the name+encoding are covered; a
     `rejected: invalid or missing signature (header=...)` line tells you the
     name we saw — compare it against SignNow's webhook docs/dashboard. If the
     name is outside the accepted list, add it to `SIGNATURE_HEADERS` in
     `app/api/webhooks/signnow/route.js`; if the encoding is exotic (not
     base64/base64url/hex), extend the candidate list in `verifyWebhook`.

### Webhook behavior

- **Bad/missing signature → 401.** No secret configured → also 401 (fail closed).
- **Authenticated but unknown shape / no matching contract → 200 `{skipped}`** so
  SignNow does not retry forever.
- **Status only advances through valid forward transitions** — a stale/replayed
  event can never move a contract backwards.
- **Per-signer "signed" events do not complete the contract on their own.** A
  document-level completion event (e.g. `document.complete`/`document.fulfilled`),
  or a payload carrying a full `field_invites` array, is required to mark the
  contract terminal `signed`. For an ambiguous per-signer event with no
  `field_invites`, the handler re-fetches the authoritative status from SignNow
  (`getSignatureStatus`) before deciding — so one signer can't prematurely
  complete, lock, and archive an unfinished contract. (If SignNow isn't
  configured to re-fetch, the status change is skipped and the next
  completion/manual sync reconciles.)
- **On fully-signed**, the signed PDF is archived into the document's version
  history. Archival is idempotent (canonical envelope-derived filename), so
  repeated `complete` events store exactly one signed copy.
- The handler never returns 5xx for an archival failure (that would trigger
  SignNow retries); it logs and reports `archived: {ok:false}` instead.

## Live QA checklist (after configuring credentials + webhook)

1. **Readiness probe:** open an admin contract document. The SignNow row should
   read **configured**.
2. **Send:** add ≥1 signer, save, click **Send via SignNow**. Confirm an
   `external_envelope_id` is stamped and `Sent` time appears. Check the
   recipient's inbox for the invite.
3. **Manual sync:** after signing one recipient, click **Check status**. Confirm
   the status advances (e.g. `partially_signed`).
4. **Webhook:** complete all signatures. Without clicking anything, confirm the
   status flips to **Fully Signed** (webhook-driven) within a few seconds. **If
   the status does NOT flip automatically, suspect the signature header
   name/format first** — check the server logs for a `rejected: invalid or
   missing signature (header=...)` line and reconcile against the
   "Signature header" notes above. (Manual **Check status** still works
   regardless, so a stuck auto-flip points at the webhook signature, not the
   sync logic.)
5. **Archive:** confirm a new document version named
   `signnow-signed-<envelopeId>.pdf` appears in the version history (auto on
   webhook/sync). Click **Archive signed PDF** again and confirm **no duplicate**
   is created ("already on file").
6. **Download:** click **Download signed** and verify the PDF is the completed,
   signed copy.
7. **Audit:** confirm `contract_send`, `contract_status_change`, and
   `contract_signed` rows in the document audit log.

## Deployment / migration notes

- **No schema migration is required for this change.** It reuses the existing
  `document_contracts`, `document_versions`, and `document_audit_log` tables. The
  archive helper writes audit rows using the already-allowed `contract_signed`
  and `contract_status_change` action values, so the existing
  `document_audit_log_action_check` constraint is **not** modified.
- Safe to deploy app code first; the integration stays inert until the env vars
  above are set. Set `SIGNNOW_WEBHOOK_SECRET` **before** registering the SignNow
  webhook, or early events will be rejected (fail-closed by design).

## Security notes

- `lib/signnow.js` is server-only. Never import it from a client component.
- Private storage URLs are never exposed; signed PDFs are streamed/stored through
  admin-gated routes and the service-role client.
- The webhook is unauthenticated by session but authenticated by HMAC signature;
  it fails closed when the secret is absent.

---

## Profile-first contract workflow (Event Organizer)

Added alongside the Event Organizer contract workflow. The SignNow mechanics
above are unchanged; what follows is the layer that now sits in front of them.

### Pre-send gate

`POST /api/admin/documents/:id/contract/signnow` no longer sends whatever it is
given. It first runs `contractSendReadiness()` from `lib/event-organizer.js` and
returns **400 `CONTRACT_NOT_READY`** with `blockers[]` and `warnings[]` when the
contract fails it. Blockers:

- no Event Organizer (`document_contracts.contact_id`) linked
- the linked organizer is `status = 'archived'`
- the organizer has no usable signer email (`default_signer_email` or `email`)
- the template is `kind = 'event'` with `requires_master = true` but no
  `master_contract_id` is selected
- a required **business** field is unfilled (those values get baked into the PDF
  before send, so a blank one would ship a blank contract)
- a field is assigned to a signer slot that has no signer behind it
- there are no signers at all

Warnings do **not** block: no signature field anywhere, no field layout at all,
an expiration date already in the past. The same function is rendered in the
staff UI, so what staff see is exactly what the server enforces.

The gate only applies when the contract has a `contact_id` or a template, so
pre-existing contracts created before this workflow keep sending as before.

### Locked contracts

`partially_signed`, `signed`, `declined`, `void` and `expired` are read-only.
`PUT .../contract` and `PUT .../contract/fields` return **409 `CONTRACT_LOCKED`**
for any change other than internal `notes`. Note this starts at
`partially_signed`, which is *not* a terminal status: once one party has signed
the exact bytes we sent, changing the terms would leave their signature attached
to a document that no longer exists. To change a locked agreement, create a new
contract (a replacement or an addendum) rather than editing it.

### Resend

A send against a contract that already has `sent_at` is treated as a resend: it
stamps `last_sent_at`, increments `send_count`, and audits `contract_resend`
instead of `contract_send`.

### `viewed` is not a status

Counterparty views are recorded as `document_contracts.viewed_at` plus a
`contract_viewed` audit row, deliberately **not** as a lifecycle status, so the
forward-only status machine and `mapInviteStatusToContract()` are untouched and a
view can never move a contract backwards.

### Counterparty notifications

On send/resend, and on webhook completion, the app writes a
`contract_notifications` row and emails the signer
(`sendContractSignatureRequest` / `sendContractCompleted` in `lib/email.js`).
Both are **best-effort**: a notification failure is logged and never fails the
send, and never makes the webhook return 5xx (which would make SignNow retry the
whole event and re-run the archive).

Neither the notification row nor the email ever contains a signing link, an
envelope id, or a storage URL. `lib/contract-notify.js` `assertNoSecrets()`
scans every assembled title/body for credential and private-URL patterns and
throws rather than sending. The only URL a counterparty receives from us is the
authenticated `https://sdgatx.com/portal/contracts`; the actual signing act
happens through SignNow's own emailed invite.

### Counterparty portal

`/portal/contracts` is gated by `requirePartner()` and reads
`partner_contracts()`, a `SECURITY DEFINER` RPC scoped by `partner_contact_id()`
that excludes drafts and returns only safe columns (no envelope id, no field
data, no storage path). `GET /api/portal/contracts/:contractId/download` streams
the PDF **only** when the contract appears in the caller's own
`partner_contracts()` result and its status is `signed`; anything else is a 404
so a partner cannot even learn that a contract id exists. There is no public or
guest contract URL anywhere in this workflow.

### New environment dependency

Counterparty email requires `RESEND_API_KEY` (already used by the rest of the
app). Without it the in-app notification row is still written and the send still
succeeds — only the email is skipped. Contract templates additionally remain
behind `CONTRACT_TEMPLATES_ENABLED=true`; with the flag off, template routes 404
and the Event page create-contract panel explains that templates are disabled.

### Extra QA steps

8. **Pre-send gate:** on a contract with a blank required business field, click
   send and confirm a 400 listing that field, with nothing sent to SignNow.
9. **Lock:** on a `partially_signed` contract, confirm the Edit button is hidden
   and a direct `PUT` of a non-`notes` field returns 409 `CONTRACT_LOCKED`.
10. **Notification:** after a send, confirm a `contract_notifications` row with
    `email_sent_at` set, a `contract_notify` audit row, and that the email body
    contains no signing link or storage URL.
11. **Portal:** sign in as the organizer, confirm the Contracts tab lists the
    contract, that a non-signed contract offers no file, and that a signed one
    opens and stamps `viewed_at` + a `contract_viewed` audit row exactly once.
