// Twilio Verify — the wall between "typed a phone number" and "controls that
// phone." Called from the SMS-verify routes and from tests via mocking.
//
// Deliberately a thin fetch wrapper rather than the twilio SDK: Verify is two
// endpoints (start + check), the SDK would pull in a couple of megabytes of
// runtime for that, and the failure modes are easier to test when the HTTP
// shape is in front of us.
//
// Env vars (all sensitive, all server-only, all set in Vercel):
//   TWILIO_ACCOUNT_SID          Account SID (AC...)
//   TWILIO_AUTH_TOKEN           Auth Token — full account credential
//   TWILIO_VERIFY_SERVICE_SID   Verify Service SID (VA...)
//
// If any is missing, isTwilioVerifyConfigured() returns false and callers must
// treat verify as unavailable. That lets local dev and CI run without a
// real account: the create route still works, the /pass form still tests,
// and only the actual send/check calls are the ones that noop.

const VERIFY_BASE = 'https://verify.twilio.com/v2/Services';

export function isTwilioVerifyConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID,
  );
}

// Basic auth header for Twilio's REST API. Rebuilt per-call so a rotated
// token picked up by the runtime takes effect immediately, and so the header
// never lives in module scope where a leak would be more visible.
function authHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

function verificationsUrl() {
  return `${VERIFY_BASE}/${process.env.TWILIO_VERIFY_SERVICE_SID}/Verifications`;
}

function verificationChecksUrl() {
  return `${VERIFY_BASE}/${process.env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
}

// Start a verification. `channel` is 'sms' (default) or 'call' — the voice
// fallback for a guest whose SMS is not arriving, or a landline. Returns
// { ok: true, status } on success; { ok: false, error, status } on any
// failure so the calling route can shape the guest-facing message.
//
// Twilio treats a same-number, same-service resend as an existing pending
// verification rather than an error, which is what we want: the "resend"
// button on the form calls this route again and Twilio decides whether to
// actually re-text or just extend the existing code's TTL.
export async function startVerification({ phone, channel = 'sms' } = {}) {
  if (!isTwilioVerifyConfigured()) {
    return { ok: false, error: 'Verification is not configured.', status: 503 };
  }
  if (!phone) {
    return { ok: false, error: 'Missing phone.', status: 400 };
  }

  const body = new URLSearchParams({ To: phone, Channel: channel });
  try {
    const res = await fetch(verificationsUrl(), {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Twilio error codes worth translating for the guest:
      //   60200 — invalid parameter (usually a malformed number)
      //   60203 — max send attempts reached for this number
      //   60212 — too many concurrent verifications
      //   60410 — number blocked (previously opted out)
      const twilioCode = data?.code;
      if (twilioCode === 60200) {
        return { ok: false, error: 'That number does not look right — check it and try again.', status: 400 };
      }
      if (twilioCode === 60203 || twilioCode === 60212) {
        return { ok: false, error: 'Too many attempts. Wait a few minutes and try again.', status: 429 };
      }
      if (twilioCode === 60410) {
        return { ok: false, error: 'That number cannot receive verification texts.', status: 400 };
      }
      console.error('[twilio-verify.start]', res.status, data);
      return { ok: false, error: 'Could not send the verification code.', status: 502 };
    }

    return { ok: true, status: data?.status || 'pending' };
  } catch (err) {
    console.error('[twilio-verify.start.exception]', err?.message || err);
    return { ok: false, error: 'Could not reach the verification service.', status: 502 };
  }
}

// Check a code. Returns { ok: true, approved: boolean } on any well-formed
// response from Twilio; only a network/config failure produces ok: false.
// The caller decides what to do with `approved: false` — usually "wrong
// code, try again" rather than an error.
//
// The 6-digit code is passed through untouched. Twilio does its own
// trimming/validation server-side; we do not want to be the reason a
// legitimate code is rejected because we stripped a leading zero.
export async function checkVerification({ phone, code } = {}) {
  if (!isTwilioVerifyConfigured()) {
    return { ok: false, error: 'Verification is not configured.', status: 503 };
  }
  if (!phone || !code) {
    return { ok: false, error: 'Missing phone or code.', status: 400 };
  }

  const body = new URLSearchParams({ To: phone, Code: String(code) });
  try {
    const res = await fetch(verificationChecksUrl(), {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const twilioCode = data?.code;
      // 20404 = "no pending verification for that number" — happens when
      // Twilio has already approved or expired the code and the guest hits
      // check twice. Treat as "not approved" rather than a 5xx.
      if (res.status === 404 || twilioCode === 20404) {
        return { ok: true, approved: false, reason: 'expired' };
      }
      console.error('[twilio-verify.check]', res.status, data);
      return { ok: false, error: 'Could not check the code.', status: 502 };
    }

    return { ok: true, approved: data?.status === 'approved' };
  } catch (err) {
    console.error('[twilio-verify.check.exception]', err?.message || err);
    return { ok: false, error: 'Could not reach the verification service.', status: 502 };
  }
}
