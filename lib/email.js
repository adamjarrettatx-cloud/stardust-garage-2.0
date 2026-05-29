// Email helper for sending notifications via Resend.
//
// Two flows:
//   1. sendInternalNotification — emails Jeyu when someone submits a form
//   2. sendUserConfirmation — emails the submitter to confirm receipt
//
// Both use the Resend HTTP API directly (no SDK dependency) for simplicity.

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'Stardust Garage <hello@sdgatx.com>';
const ADMIN_INBOX = 'jeyu@sdgatx.com';

// Friendly human-readable label for each form type. Used in email subjects
// and bodies so the team can tell at a glance what kind of submission it is.
const FORM_LABELS = {
  signup: 'Newsletter Signup',
  membership_application: 'Membership Application',
  venue_inquiry: 'Venue Rental Inquiry',
  micro_party_inquiry: 'Micro Party Inquiry',
  collaboration: 'Collaboration Request',
};

// User-facing copy for the confirmation email. Each form gets a friendly
// subject line and message body tailored to what the user just submitted.
const USER_CONFIRMATIONS = {
  signup: {
    subject: 'Welcome to the Stardust Garage list',
    heading: 'You\'re on the list.',
    body: 'Thanks for signing up. You\'ll be the first to know about new events, parties, and members-only experiences at Stardust Garage. We don\'t send a lot of email — only when something\'s actually worth knowing.',
  },
  membership_application: {
    subject: 'We received your membership application',
    heading: 'Thanks for applying.',
    body: 'We got your membership application and someone from our team will review it and follow up within a few days. In the meantime, feel free to follow along on Instagram for what we\'re up to.',
  },
  venue_inquiry: {
    subject: 'We received your venue inquiry',
    heading: 'Thanks for reaching out.',
    body: 'We got your venue rental inquiry and someone from our team will review the details and follow up within 48 hours to discuss availability and next steps.',
  },
  micro_party_inquiry: {
    subject: 'We received your micro party inquiry',
    heading: 'Thanks for reaching out.',
    body: 'We got your micro party inquiry and someone from our team will review the details and follow up within 48 hours to discuss availability and next steps.',
  },
  collaboration: {
    subject: 'We received your collaboration request',
    heading: 'Thanks for getting in touch.',
    body: 'We got your collaboration request and our team will review it carefully. We\'ll follow up if it\'s a good fit.',
  },
};

// Renders a key/value pair as a row in the internal email table. We skip
// empty/null values so the email isn\'t cluttered with blanks.
function renderField(label, value) {
  if (value === null || value === undefined || value === '') return '';
  let displayValue = value;
  if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No';
  return `
    <tr>
      <td style="padding:8px 12px;color:#666;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;width:180px;vertical-align:top;">${label}</td>
      <td style="padding:8px 12px;color:#111;font-size:14px;line-height:1.5;">${String(displayValue).replace(/\n/g, '<br>')}</td>
    </tr>
  `;
}

// Builds the HTML body for the internal admin notification.
function renderInternalHtml({ formType, data }) {
  const label = FORM_LABELS[formType] || 'New Form Submission';
  const fieldsHtml = Object.entries(data)
    .map(([key, value]) => {
      // Pretty-print keys: full_name -> Full Name
      const prettyKey = key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());
      return renderField(prettyKey, value);
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
    <div style="background:#0a0a0a;color:#ffffff;padding:24px 28px;">
      <div style="font-size:11px;letter-spacing:0.2em;font-weight:600;color:#aaa;margin-bottom:6px;">STARDUST GARAGE · ADMIN</div>
      <div style="font-size:22px;font-weight:700;">New ${label}</div>
    </div>
    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
      ${fieldsHtml}
    </table>
    <div style="padding:20px 28px;border-top:1px solid #eee;color:#888;font-size:12px;">
      Review in admin dashboard → <a href="https://sdgatx.com/admin" style="color:#0a0a0a;">sdgatx.com/admin</a>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Builds the HTML body for the user confirmation email.
function renderUserConfirmationHtml({ formType }) {
  const { heading, body } =
    USER_CONFIRMATIONS[formType] || USER_CONFIRMATIONS.signup;

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
  <div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
    <div style="padding:40px 32px 32px 32px;text-align:center;">
      <div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div>
      <div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div>

      <h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">
        ${heading}
      </h1>
      <p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.7);margin:0 0 32px 0;">
        ${body}
      </p>

      <a href="https://sdgatx.com" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:12px 24px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;">
        VISIT THE SITE
      </a>
    </div>

    <div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">
      4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Send a single email through the Resend API. Returns the parsed JSON
// on success, throws on error.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errorBody}`);
  }

  return res.json();
}

// PUBLIC: Send the internal notification email to the team inbox.
export async function sendInternalNotification({ formType, data }) {
  const label = FORM_LABELS[formType] || 'Form Submission';
  return sendEmail({
    to: ADMIN_INBOX,
    subject: `New ${label} — Stardust Garage`,
    html: renderInternalHtml({ formType, data }),
  });
}

// PUBLIC: Send the user confirmation email to the submitter.
export async function sendUserConfirmation({ formType, email }) {
  if (!email) return null;
  const config = USER_CONFIRMATIONS[formType] || USER_CONFIRMATIONS.signup;
  return sendEmail({
    to: email,
    subject: config.subject,
    html: renderUserConfirmationHtml({ formType }),
  });
}
