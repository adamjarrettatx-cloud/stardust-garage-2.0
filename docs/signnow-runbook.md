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
   `HMAC-SHA256(rawBody, SIGNNOW_WEBHOOK_SECRET)` (base64) and constant-time
   compares it against the signature header. Accepted header names:
   `x-signnow-signature`, `signnow-signature`, `x-signature`, `signature`.

### Webhook behavior

- **Bad/missing signature → 401.** No secret configured → also 401 (fail closed).
- **Authenticated but unknown shape / no matching contract → 200 `{skipped}`** so
  SignNow does not retry forever.
- **Status only advances through valid forward transitions** — a stale/replayed
  event can never move a contract backwards.
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
   status flips to **Fully Signed** (webhook-driven) within a few seconds.
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
