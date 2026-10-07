# Meta Pixel and Conversions API

Measures Meta (Facebook/Instagram) ad results for public pages and online
ticket and membership purchases. Off until configured.

## What is sent

| Event | Where | When |
|---|---|---|
| PageView | Browser | Each public page view |
| ViewContent | Browser | Public (not unlisted) event page viewed |
| InitiateCheckout | Browser | Buyer is sent to Stripe Checkout for tickets |
| Purchase | Server (Stripe webhook) | Ticket order finalized and paid |
| Subscribe | Server (Stripe webhook) | Initial membership checkout completed |

Purchase and Subscribe are server-only, so Meta never counts an unpaid order.
Email and user id are SHA-256 hashed before sending. Ticket Tailor purchases
happen off-site and are not reported.

## Where Meta never runs

- Staff, admin, station, portal, account, member, login and token routes, and
  any URL carrying a token or identifier query parameter (`lib/meta/policy.js`).
- Browsers sending Global Privacy Control.
- Visitors who arrived from the SDG mobile app (`/handoff` sets `sdg_meta_off`
  for 30 days) and Bearer-token API calls from the app.
- Unlisted events.
- Automatic button/form scanning is disabled (`autoConfig` off).

## Configuration (Vercel)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | `2525415987959538` (Stardust Garage Website Pixel) |
| `META_CAPI_ACCESS_TOKEN` | Events Manager → pixel → Settings → Conversions API → Generate access token |
| `META_TEST_EVENT_CODE` | Optional; Events Manager → Test events code, for verification only. Remove after testing. |

The browser pixel needs only the pixel id. Server events need both.

## Prerequisite

The Privacy Policy must disclose Meta advertising measurement before these
variables are set in production.
