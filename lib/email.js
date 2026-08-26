// Email helper for sending notifications via Resend.

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'Stardust Garage <hello@sdgatx.com>';
const ADMIN_INBOX = 'jeyu@sdgatx.com';

const FORM_LABELS = {
  signup: 'Newsletter Signup',
  membership_application: 'Membership Application',
  venue_inquiry: 'Venue Rental Inquiry',
  micro_party_inquiry: 'Micro Party Inquiry',
  collaboration: 'Collaboration Request',
  artist_pay_request: 'Artist Pay Request',
};

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

function renderField(label, value) {
  if (value === null || value === undefined || value === '') return '';
  let displayValue = value;
  if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No';
  return `<tr><td style="padding:8px 12px;color:#666;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;width:180px;vertical-align:top;">${label}</td><td style="padding:8px 12px;color:#111;font-size:14px;line-height:1.5;">${String(displayValue).replace(/\n/g, '<br>')}</td></tr>`;
}

function renderInternalHtml({ formType, data }) {
  const label = FORM_LABELS[formType] || 'New Form Submission';
  const fieldsHtml = Object.entries(data).map(([key, value]) => {
    const prettyKey = key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    return renderField(prettyKey, value);
  }).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;"><div style="background:#0a0a0a;color:#ffffff;padding:24px 28px;"><div style="font-size:11px;letter-spacing:0.2em;font-weight:600;color:#aaa;margin-bottom:6px;">STARDUST GARAGE · ADMIN</div><div style="font-size:22px;font-weight:700;">New ${label}</div></div><table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">${fieldsHtml}</table><div style="padding:20px 28px;border-top:1px solid #eee;color:#888;font-size:12px;">Review in admin dashboard → <a href="https://sdgatx.com/bananas" style="color:#0a0a0a;">sdgatx.com/bananas</a></div></div></body></html>`;
}

function renderUserConfirmationHtml({ formType }) {
  const { heading, body } = USER_CONFIRMATIONS[formType] || USER_CONFIRMATIONS.signup;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.7);margin:0 0 32px 0;">${body}</p><a href="https://sdgatx.com" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:12px 24px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;">VISIT THE SITE</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

function renderMemberWelcomeHtml({ fullName, email, tempPassword }) {
  const safeName = (fullName || '').split(' ')[0] || 'there';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">Welcome, ${safeName}.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your membership application has been approved! To activate your membership, sign in and choose your billing plan.</p><div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:20px;margin:0 0 24px 0;text-align:left;"><div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">EMAIL</div><div style="font-size:14px;color:#fff;margin-bottom:16px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">${email}</div><div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">TEMPORARY PASSWORD</div><div style="font-size:14px;color:#fff;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;letter-spacing:0.05em;">${tempPassword}</div></div><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 32px 0;text-align:left;">For your security, change this password after your first sign-in via Account Settings.</p><a href="https://sdgatx.com/login" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">SIGN IN & ACTIVATE</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

// Password reset. Mirrors renderPartnerInviteHtml's pattern exactly: the link
// is OUR host redeeming a Supabase recovery token ourselves (see
// buildPasswordResetUrl in lib/partner-identity.js), never Supabase's own
// action_link, so nothing pointing at *.supabase.co ever reaches an inbox.
function renderPasswordResetHtml({ resetUrl }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">Reset your password.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.7);margin:0 0 32px 0;">We received a request to reset the password on your Stardust Garage account. Click below to choose a new one. This link is single-use and expires in 1 hour.</p><a href="${resetUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">RESET PASSWORD</a><p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);margin:16px 0 0 0;">If you didn't request this, you can safely ignore this email — your password won't change.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

// Partner invite. Unlike the member welcome email there is no password here —
// the link IS the credential (a single-use Supabase magic link), and clicking it
// drops the invitee straight onto /portal/activate to set their name + photo.
//
// `role` is the role-specific noun for this contact ("DJ", "Collective",
// "Promoter"...) chosen by roleLabel(contact.contact_type). It drives the H1
// and subject. `contactTypeDisplay` is the human-friendly type list
// ("DJ, Collective") used only in the "You're listed with us as" line.
function renderPartnerInviteHtml({ fullName, role, contactTypeDisplay, activationUrl, isContractor = false }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const safeRole = escapeHtml(role || 'Portal');
  const roleLower = safeRole.toLowerCase();
  const listedAs = contactTypeDisplay ? escapeHtml(contactTypeDisplay) : null;
  const roleLine = listedAs
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">You're listed with us as: ${listedAs}.</p>`
    : '';
  // Contractors (DJ/artist/performer) don't manage a guest list through this
  // login — they get booked for a set and, later, request payment for it. Two
  // different reasons to have a portal login need two different intros so
  // this doesn't read like a mismatched auto-email.
  const intro = isContractor
    ? `We've set you up with a Stardust Garage ${roleLower} profile. It's where you'll see the events you're booked for, and once you're activated you'll be able to request payment for a set as soon as it wraps.`
    : `We've set you up with a Stardust Garage ${roleLower} profile. It's where you'll manage your guest list for the nights you're working with us — the names you add get free or discounted entry at the door.`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, set up your ${roleLower} profile.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${intro}</p>${roleLine}<p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">Verify your email and finish your profile below. It takes a minute: confirm your name and add a photo so our door staff know who you are.</p><a href="${activationUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VERIFY & CREATE PROFILE</a><p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);margin:16px 0 0 0;">This link signs you in once and expires. If it's stopped working, ask us for a new one.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

// Guest list grant. Only ever mailed to a partner who has already activated —
// the CTA is their portal, so an invited-but-not-activated contact would land on
// a sign-in they cannot pass (see resolveGrantNotification in
// lib/guestlist-helpers.js).
function renderGuestlistGrantHtml({ fullName, eventTitle, eventDate, freeSlots, discountSlots, discountDetail, guestListUrl, isUpdate }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const heading = isUpdate
    ? `${safeName}, your guest list just changed.`
    : `${safeName}, you're on the door.`;
  const intro = isUpdate
    ? `We've updated your guest list allocation for <strong style="color:#ffffff;">${escapeHtml(eventTitle)}</strong>${eventDate ? ` on ${escapeHtml(eventDate)}` : ''}.`
    : `You've been added to the guest list for <strong style="color:#ffffff;">${escapeHtml(eventTitle)}</strong>${eventDate ? ` on ${escapeHtml(eventDate)}` : ''}.`;
  const allowance = [
    freeSlots > 0 ? `${freeSlots} free ${freeSlots === 1 ? 'spot' : 'spots'}` : null,
    discountSlots > 0 ? `${discountSlots} discounted ${discountSlots === 1 ? 'spot' : 'spots'}` : null,
  ]
    .filter(Boolean)
    .join(' and ');
  const detailLine = discountDetail
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">Discount at the door: ${escapeHtml(discountDetail)}.</p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${intro} You can add up to ${allowance} to the list.</p>${detailLine}<p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">Add your guests' names in your partner portal — door staff check them in by name on the night.</p><a href="${guestListUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">MANAGE YOUR GUEST LIST</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

function renderDiscountCodeHtml({ fullName, eventTitle, eventDate, eventTime, code, ticketUrl }) {
  const firstName = (fullName || '').split(' ')[0] || 'there';
  const when = [eventDate, eventTime].filter(Boolean).join(' · ');
  const ctaHref = ticketUrl || 'https://sdgatx.com/events';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:24px;font-weight:800;margin:0 0 24px 0;letter-spacing:-0.02em;line-height:1.3;color:#ffffff;">${firstName}, here's your exclusive member access code.</h1><div style="font-size:22px;font-weight:800;color:#ffb84d;margin:0 0 6px 0;letter-spacing:-0.01em;">${eventTitle}</div>${when ? `<div style="font-size:14px;color:#8a8a8a;margin:0 0 28px 0;">${when}</div>` : '<div style="margin-bottom:28px;"></div>'}<div style="font-size:13px;color:#8a8a8a;letter-spacing:0.08em;margin:0 0 12px 0;">Your 60% member discount code:</div><div style="display:inline-block;border:1px solid #ffb84d;border-radius:10px;padding:18px 28px;margin:0 0 28px 0;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:0.12em;color:#ffffff;">${code}</div><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.6);margin:0 0 32px 0;">This code is single-use and valid only for this event. It expires on ${eventDate}.</p><a href="${ctaHref}" style="display:inline-block;background:#ffb84d;color:#0a0a0a;padding:14px 32px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-decoration:none;">GET TICKETS</a><div style="border:1px solid #8b1a1a;background:#1a0a0a;border-radius:10px;padding:16px 20px;margin:32px 0 0 0;text-align:left;"><p style="font-size:12px;line-height:1.6;color:#c97070;margin:0;">This code is issued exclusively to you as a Stardust Garage member. Sharing this code with anyone outside of your membership is a violation of your Membership Agreement. Any member found sharing their discount code may have their membership revoked and will be subject to a $99 penalty fee.</p></div></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">Stardust Garage · Members Only</div></div></body></html>`;
}

async function sendEmail({ to, subject, html, from, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const payload = {
    from: from || FROM_ADDRESS,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errorBody}`);
  }

  return res.json();
}

export async function sendInternalNotification({ formType, data }) {
  const label = FORM_LABELS[formType] || 'Form Submission';
  return sendEmail({
    to: ADMIN_INBOX,
    subject: `New ${label} — Stardust Garage`,
    html: renderInternalHtml({ formType, data }),
  });
}

export async function sendUserConfirmation({ formType, email }) {
  if (!email) return null;
  const config = USER_CONFIRMATIONS[formType] || USER_CONFIRMATIONS.signup;
  return sendEmail({
    to: email,
    subject: config.subject,
    html: renderUserConfirmationHtml({ formType }),
  });
}

export async function sendDiscountCode({ email, fullName, eventTitle, eventDate, eventTime, code, ticketUrl }) {
  if (!email || !code) {
    throw new Error('sendDiscountCode requires email and code');
  }
  return sendEmail({
    to: email,
    subject: `Your Member Code for ${eventTitle}`,
    html: renderDiscountCodeHtml({ fullName, eventTitle, eventDate, eventTime, code, ticketUrl }),
  });
}

export async function sendMemberWelcome({ email, fullName, tempPassword }) {
  if (!email || !tempPassword) {
    throw new Error('sendMemberWelcome requires email and tempPassword');
  }
  return sendEmail({
    to: email,
    subject: 'Your Stardust Garage membership — activate now',
    html: renderMemberWelcomeHtml({ fullName, email, tempPassword }),
  });
}

export async function sendPartnerInvite({ email, fullName, role, contactTypeDisplay, activationUrl, isContractor = false }) {
  if (!email || !activationUrl) {
    throw new Error('sendPartnerInvite requires email and activationUrl');
  }
  const roleLower = (role || 'portal').toLowerCase();
  return sendEmail({
    to: email,
    subject: `Set up your Stardust Garage ${roleLower} profile`,
    html: renderPartnerInviteHtml({ fullName, role, contactTypeDisplay, activationUrl, isContractor }),
  });
}

export async function sendPasswordReset({ email, resetUrl }) {
  if (!email || !resetUrl) {
    throw new Error('sendPasswordReset requires email and resetUrl');
  }
  return sendEmail({
    to: email,
    subject: 'Reset your Stardust Garage password',
    html: renderPasswordResetHtml({ resetUrl }),
  });
}

export async function sendGuestlistGrant({
  email,
  fullName,
  eventTitle,
  eventDate,
  freeSlots = 0,
  discountSlots = 0,
  discountDetail,
  guestListUrl,
  isUpdate = false,
}) {
  if (!email || !eventTitle || !guestListUrl) {
    throw new Error('sendGuestlistGrant requires email, eventTitle and guestListUrl');
  }
  return sendEmail({
    to: email,
    subject: isUpdate
      ? `Your guest list for ${eventTitle} has been updated`
      : `You're on the guest list for ${eventTitle}`,
    html: renderGuestlistGrantHtml({
      fullName,
      eventTitle,
      eventDate,
      freeSlots,
      discountSlots,
      discountDetail,
      guestListUrl,
      isUpdate,
    }),
  });
}

// ---------------------------------------------------------------------------
// Admin "Reply" emails — sent from a submission detail page in the admin
// dashboard (venue inquiry, micro-party, collaboration, application).
//
// These always send FROM the shared, domain-verified hello@sdgatx.com address
// (Resend only delivers reliably from a domain it has verified — an
// individual admin's personal Gmail is not authorized to send through our
// Resend account). To make the reply still feel personally from that admin:
//   - the FROM display name is set to "<Admin Name> · Stardust Garage"
//   - Reply-To is set to the admin's own work email (e.g. david@sdgatx.com),
//     so when the recipient hits "Reply", it goes straight to that admin's
//     real Gmail inbox, not the shared hello@ address.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTeamReplyHtml({ bodyText, senderName }) {
  const safeBody = escapeHtml(bodyText || '').replace(/\n/g, '<br>');
  const signature = senderName
    ? `<p style="font-size:14px;line-height:1.6;color:#333;margin:24px 0 0 0;">${escapeHtml(senderName)}<br><span style="color:#888;">Stardust Garage</span></p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;"><div style="padding:32px 32px 8px 32px;"><div style="font-size:11px;letter-spacing:0.2em;font-weight:600;color:#aaa;margin-bottom:20px;">STARDUST GARAGE</div><p style="font-size:15px;line-height:1.65;color:#111;margin:0;">${safeBody}</p>${signature}</div><div style="padding:18px 32px;border-top:1px solid #eee;color:#999;font-size:11px;margin-top:24px;">4319 Terry-O Ln · Austin, TX 78745</div></div></body></html>`;
}

export async function sendTeamReply({ to, subject, bodyText, senderEmail, senderName }) {
  if (!to || !subject || !bodyText) {
    throw new Error('sendTeamReply requires to, subject, and bodyText');
  }
  if (!senderEmail) {
    throw new Error('sendTeamReply requires senderEmail for Reply-To');
  }
  const fromDisplay = senderName
    ? `${senderName} · Stardust Garage <hello@sdgatx.com>`
    : FROM_ADDRESS;
  return sendEmail({
    to,
    subject,
    html: renderTeamReplyHtml({ bodyText, senderName }),
    from: fromDisplay,
    replyTo: senderEmail,
  });
}

// ---------------------------------------------------------------------------
// Artist / DJ Pay System — Phase 3 (Request Pay + Review & Pay).
//
// Mirrors renderGuestlistGrantHtml's dark card style/layout exactly (same
// STARDUST GARAGE wordmark block, same pill CTA, same footer) so an artist
// who already got a guest-list-grant email recognizes this as the same
// brand voice rather than a bolted-on template.
// ---------------------------------------------------------------------------
function renderArtistPayApprovedHtml({ fullName, eventTitle, amountLabel, payUrl }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const safeEvent = escapeHtml(eventTitle || 'your set');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, your pay request was approved.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your <strong style="color:#ffffff;">${amountLabel}</strong> request for <strong style="color:#ffffff;">${safeEvent}</strong> has been approved.</p><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">This confirms the amount is cleared to pay — it does not mean funds have moved yet. We'll follow up separately once the payout itself is sent.</p><a href="${payUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VIEW IN YOUR PORTAL</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

function renderArtistPayRejectedHtml({ fullName, eventTitle, amountLabel, rejectionReason, payUrl }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const safeEvent = escapeHtml(eventTitle || 'your set');
  const reasonLine = rejectionReason
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">Reason: ${escapeHtml(rejectionReason)}</p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, your pay request needs another look.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your <strong style="color:#ffffff;">${amountLabel}</strong> request for <strong style="color:#ffffff;">${safeEvent}</strong> was not approved as submitted.</p>${reasonLine}<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">Reach out to our team and we'll sort it out — once the booking is reopened for payment, you'll be able to request again from your portal.</p><a href="${payUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VIEW IN YOUR PORTAL</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

export async function sendArtistPayApproved({ email, fullName, eventTitle, amountLabel, payUrl }) {
  if (!email || !eventTitle || !amountLabel || !payUrl) {
    throw new Error('sendArtistPayApproved requires email, eventTitle, amountLabel and payUrl');
  }
  return sendEmail({
    to: email,
    subject: `Your pay request for ${eventTitle} was approved`,
    html: renderArtistPayApprovedHtml({ fullName, eventTitle, amountLabel, payUrl }),
  });
}

export async function sendArtistPayRejected({ email, fullName, eventTitle, amountLabel, rejectionReason, payUrl }) {
  if (!email || !eventTitle || !amountLabel || !payUrl) {
    throw new Error('sendArtistPayRejected requires email, eventTitle, amountLabel and payUrl');
  }
  return sendEmail({
    to: email,
    subject: `Update on your pay request for ${eventTitle}`,
    html: renderArtistPayRejectedHtml({ fullName, eventTitle, amountLabel, rejectionReason, payUrl }),
  });
}

// ---------------------------------------------------------------------------
// Trial SDG Pass — pass delivery + the six-day nudge sequence.
//
// Same dark card as the guest-list grant and artist-pay emails (identical
// wordmark block, pill CTA, footer) so a guest who scanned a QR in the venue
// gets something that looks like it came from the same place.
//
// Both templates lead with the pass link rather than a QR image: a PNG in an
// email is at the mercy of every client's image blocking, and the pass page
// renders the code as inline SVG that always draws. The link IS the pass.
// ---------------------------------------------------------------------------
function renderTrialPassHtml({ fullName, passUrl, expiresLabel }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">Your Trial SDG Pass is ready.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${safeName}, thanks for signing up. Open your pass below and show the code at the door for faster check-in. We sent this as a backup in case you closed the page before saving it.</p><a href="${passUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:24px;">OPEN MY PASS</a><div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:18px 20px;margin:0 0 8px 0;text-align:left;"><div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">GOOD THROUGH</div><div style="font-size:15px;color:#ffffff;font-weight:600;">${escapeHtml(expiresLabel)}</div></div><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:16px 0 0 0;text-align:left;">Your pass covers Friday through Sunday music events. Apply for membership before it runs out to keep your access — we'll remind you along the way.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

// The nudge. Copy shifts with how much time is left rather than repeating the
// same paragraph four times — a guest who gets an identical email on days 6,
// 12, 18 and 24 stops opening it by the second one.
function renderTrialReminderHtml({ fullName, passUrl, applyUrl, daysLeft, expiresLabel }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const urgent = daysLeft <= 7;
  const heading = urgent
    ? `${safeName}, your trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`
    : `${safeName}, your Trial SDG Pass is still open.`;
  const body = urgent
    ? `Your trial pass stops working on ${escapeHtml(expiresLabel)}. If you want to keep coming out, get your membership application in before then.`
    : `You have ${daysLeft} days left on your Trial SDG Pass. It covers Friday through Sunday music events — come use it, and apply for membership whenever you're ready.`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">${body}</p><a href="${applyUrl}" style="display:inline-block;background:#ffb84d;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">APPLY FOR MEMBERSHIP</a><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:8px 0 0 0;">Need your pass again? <a href="${passUrl}" style="color:#ffffff;">Open it here</a>.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">4319 Terry-O Ln · Austin, TX 78745 · hello@sdgatx.com</div></div></body></html>`;
}

export async function sendTrialPassDelivery({ email, fullName, passUrl, expiresLabel }) {
  if (!email || !passUrl) {
    throw new Error('sendTrialPassDelivery requires email and passUrl');
  }
  return sendEmail({
    to: email,
    subject: 'Your Trial SDG Pass is Ready',
    html: renderTrialPassHtml({ fullName, passUrl, expiresLabel }),
  });
}

export async function sendTrialPassReminder({ email, fullName, passUrl, applyUrl, daysLeft, expiresLabel }) {
  if (!email || !passUrl || !applyUrl) {
    throw new Error('sendTrialPassReminder requires email, passUrl and applyUrl');
  }
  const urgent = daysLeft <= 7;
  return sendEmail({
    to: email,
    subject: urgent
      ? `Your Trial SDG Pass ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
      : 'Your Trial SDG Pass is still open',
    html: renderTrialReminderHtml({ fullName, passUrl, applyUrl, daysLeft, expiresLabel }),
  });
}
