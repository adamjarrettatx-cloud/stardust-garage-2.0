// Email helper for sending notifications via Resend.

import { getHeroPngBuffer } from './email/cosmos-assets.js';

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
  return `<tr><td style="padding:8px 12px;color:#666;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;width:180px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 12px;color:#111;font-size:14px;line-height:1.5;">${escapeHtml(displayValue).replace(/\n/g, '<br>')}</td></tr>`;
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
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.7);margin:0 0 32px 0;">${body}</p><a href="https://sdgatx.com" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:12px 24px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;">VISIT THE SITE</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

function renderMemberWelcomeHtml({ fullName, email, tempPassword }) {
  const safeName = (fullName || '').split(' ')[0] || 'there';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">Welcome, ${safeName}.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your membership application has been approved! To activate your membership, sign in and choose your billing plan.</p><div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:20px;margin:0 0 24px 0;text-align:left;"><div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">EMAIL</div><div style="font-size:14px;color:#fff;margin-bottom:16px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">${email}</div><div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">TEMPORARY PASSWORD</div><div style="font-size:14px;color:#fff;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;letter-spacing:0.05em;">${tempPassword}</div></div><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 32px 0;text-align:left;">For your security, change this password after your first sign-in via Account Settings.</p><a href="https://sdgatx.com/login" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">SIGN IN & ACTIVATE</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

// Password reset. Mirrors renderPartnerInviteHtml's pattern exactly: the link
// is OUR host redeeming a Supabase recovery token ourselves (see
// buildPasswordResetUrl in lib/partner-identity.js), never Supabase's own
// action_link, so nothing pointing at *.supabase.co ever reaches an inbox.
function renderPasswordResetHtml({ resetUrl }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">Reset your password.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.7);margin:0 0 32px 0;">We received a request to reset the password on your Stardust Garage account. Click below to choose a new one. This link is single-use and expires in 1 hour.</p><a href="${resetUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">RESET PASSWORD</a><p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);margin:16px 0 0 0;">If you didn't request this, you can safely ignore this email — your password won't change.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
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
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, set up your ${roleLower} profile.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${intro}</p>${roleLine}<p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">Verify your email and finish your profile below. It takes a minute: confirm your name and add a photo so our door staff know who you are.</p><a href="${activationUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VERIFY & CREATE PROFILE</a><p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);margin:16px 0 0 0;">This link signs you in once and expires. If it's stopped working, ask us for a new one.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
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
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${intro} You can add up to ${allowance} to the list.</p>${detailLine}<p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">Add your guests' names in your partner portal — door staff check them in by name on the night.</p><a href="${guestListUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">MANAGE YOUR GUEST LIST</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

function renderDiscountCodeHtml({ fullName, eventTitle, eventDate, eventTime, code, ticketUrl }) {
  const firstName = (fullName || '').split(' ')[0] || 'there';
  const when = [eventDate, eventTime].filter(Boolean).join(' · ');
  const ctaHref = ticketUrl || 'https://sdgatx.com/events';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:24px;font-weight:800;margin:0 0 24px 0;letter-spacing:-0.02em;line-height:1.3;color:#ffffff;">${firstName}, here's your exclusive member access code.</h1><div style="font-size:22px;font-weight:800;color:#ffb84d;margin:0 0 6px 0;letter-spacing:-0.01em;">${eventTitle}</div>${when ? `<div style="font-size:14px;color:#8a8a8a;margin:0 0 28px 0;">${when}</div>` : '<div style="margin-bottom:28px;"></div>'}<div style="font-size:13px;color:#8a8a8a;letter-spacing:0.08em;margin:0 0 12px 0;">Your 60% member discount code:</div><div style="display:inline-block;border:1px solid #ffb84d;border-radius:10px;padding:18px 28px;margin:0 0 28px 0;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:0.12em;color:#ffffff;">${code}</div><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.6);margin:0 0 32px 0;">This code is single-use and valid only for this event. It expires on ${eventDate}.</p><a href="${ctaHref}" style="display:inline-block;background:#ffb84d;color:#0a0a0a;padding:14px 32px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-decoration:none;">GET TICKETS</a><div style="border:1px solid #8b1a1a;background:#1a0a0a;border-radius:10px;padding:16px 20px;margin:32px 0 0 0;text-align:left;"><p style="font-size:12px;line-height:1.6;color:#c97070;margin:0;">This code is issued exclusively to you as a Stardust Garage member. Sharing this code with anyone outside of your membership is a violation of your Membership Agreement. Any member found sharing their discount code may have their membership revoked and will be subject to a $99 penalty fee.</p></div></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">Stardust Garage · Members Only</div></div></body></html>`;
}

// attachments: optional array of Resend attachment descriptors
// ({ filename, content, content_id?, content_type? }). `content` can be a
// base64 string or a Node Buffer (converted to base64 here). content_id
// enables inline reference from HTML as <img src="cid:my-id">, which is
// how ticket QRs make it into Gmail / Outlook where inline SVG and
// data: URIs are stripped.
async function sendEmail({ to, subject, html, from, replyTo, attachments }) {
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
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
      ...(a.content_id ? { content_id: a.content_id } : {}),
      ...(a.content_type ? { content_type: a.content_type } : {}),
    }));
  }

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

export async function sendAccountDeletionConfirmation({ email }) {
  if (!email) throw new Error('sendAccountDeletionConfirmation requires email');
  return sendEmail({
    to: email,
    subject: 'Your Stardust Garage account has been deleted',
    html: `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:36px 32px;"><div style="font-size:11px;letter-spacing:.28em;color:rgba(255,255,255,.5);margin-bottom:28px;">STARDUST GARAGE</div><h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;color:#fff;">Your account has been deleted.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,.75);">Your Stardust Garage account deletion is complete and cannot be reversed. Your profile and account access have been permanently removed. Past orders and attendance records are retained only in anonymized form where required for accounting and capacity records.</p><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,.75);margin-bottom:0;">If you did not request this deletion, contact us as soon as possible at <a href="mailto:hello@sdgatx.com" style="color:#d9c48c;">hello@sdgatx.com</a>.</p></div></body></html>`,
  });
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
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTeamReplyHtml({ bodyText, senderName }) {
  const safeBody = escapeHtml(bodyText || '').replace(/\n/g, '<br>');
  const signature = senderName
    ? `<p style="font-size:14px;line-height:1.6;color:#333;margin:24px 0 0 0;">${escapeHtml(senderName)}<br><span style="color:#888;">Stardust Garage</span></p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;"><div style="padding:32px 32px 8px 32px;"><div style="font-size:11px;letter-spacing:0.2em;font-weight:600;color:#aaa;margin-bottom:20px;">STARDUST GARAGE</div><p style="font-size:15px;line-height:1.65;color:#111;margin:0;">${safeBody}</p>${signature}</div><div style="padding:18px 32px;border-top:1px solid #eee;color:#999;font-size:11px;margin-top:24px;">hello@sdgatx.com</div></div></body></html>`;
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
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, your pay request was approved.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your <strong style="color:#ffffff;">${amountLabel}</strong> request for <strong style="color:#ffffff;">${safeEvent}</strong> has been approved.</p><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">This confirms the amount is cleared to pay — it does not mean funds have moved yet. We'll follow up separately once the payout itself is sent.</p><a href="${payUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VIEW IN YOUR PORTAL</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

function renderArtistPayRejectedHtml({ fullName, eventTitle, amountLabel, rejectionReason, payUrl }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const safeEvent = escapeHtml(eventTitle || 'your set');
  const reasonLine = rejectionReason
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">Reason: ${escapeHtml(rejectionReason)}</p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, your pay request needs another look.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your <strong style="color:#ffffff;">${amountLabel}</strong> request for <strong style="color:#ffffff;">${safeEvent}</strong> was not approved as submitted.</p>${reasonLine}<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">Reach out to our team and we'll sort it out — once the booking is reopened for payment, you'll be able to request again from your portal.</p><a href="${payUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VIEW IN YOUR PORTAL</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
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
// The delivery email. Sent the moment the guest finishes the QR intake form.
// `expiresLabel` here is the ACTIVATE-BY date (signup + 60 days) — it is the
// deadline for the guest to actually walk in the door and start the 30-day
// clock. The 30-day membership window is deliberately not shown as a date
// yet, because it doesn't have one until they physically show up.
function renderTrialPassHtml({ fullName, passUrl, expiresLabel }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">Your Trial SDG Pass is ready.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${safeName}, thanks for signing up. Your 30-day trial starts the first night you come out — show the code below at the door to activate it. Open your pass and save it to your phone so you have it on hand.</p><a href="${passUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:24px;">OPEN MY PASS</a><div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:18px 20px;margin:0 0 8px 0;text-align:left;"><div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">30-DAY TRIAL</div><div style="font-size:15px;color:#ffffff;font-weight:600;">Starts on your first visit.</div><div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:6px;">Show the code at the door. Your 30 days start when we scan you in — not before.</div></div><p style="font-size:12px;line-height:1.55;color:rgba(255,255,255,0.4);margin:12px 0 0 0;text-align:left;">Heads up: if this QR isn't used by ${escapeHtml(expiresLabel)} it will expire — that's just the QR itself, not your 30-day trial.</p><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:16px 0 0 0;text-align:left;">Your pass covers our Weekend Music Experiences. Come use it, then apply for membership before your 30 days run out to keep your access — we'll remind you along the way.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

// The nudge. Two very different messages depending on whether the guest has
// activated their pass:
//
//   kind='activation_nudge' — they signed up but never came out. The message
//     is a warm come-on-out; the CTA is "Open my pass", not "Apply for
//     membership", because applying without a visit is a much colder ask.
//
//   kind='application_nudge' — they came out and their 30-day clock is
//     ticking. This is the old reminder: convert the trial into a member.
//     Copy urgency scales with daysLeft.
function renderTrialReminderHtml({ fullName, passUrl, applyUrl, daysLeft, expiresLabel, kind }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');

  if (kind === 'activation_nudge') {
    const heading = `${safeName}, your trial pass is waiting.`;
    const body = `You picked up a Trial SDG Pass but haven't come out yet — your 30-day trial doesn't start until your first visit. It covers our Weekend Music Experiences. Come by, show the code at the door, and the clock starts then.`;
    return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">${body}</p><a href="${passUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">OPEN MY PASS</a><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:8px 0 0 0;">Your QR expires on ${escapeHtml(expiresLabel)} if you don't come by — your 30-day trial itself doesn't start until your first visit.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
  }

  // Default: application_nudge (activated pass, 30-day clock ticking).
  const urgent = daysLeft <= 7;
  const heading = urgent
    ? `${safeName}, your trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`
    : `${safeName}, your Trial SDG Pass is still open.`;
  const body = urgent
    ? `Your trial pass stops working on ${escapeHtml(expiresLabel)}. If you want to keep coming out, get your membership application in before then.`
    : `You have ${daysLeft} days left on your Trial SDG Pass. It covers our Weekend Music Experiences — come use it, and apply for membership whenever you're ready.`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">${body}</p><a href="${applyUrl}" style="display:inline-block;background:#ffb84d;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">APPLY FOR MEMBERSHIP</a><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:8px 0 0 0;">Need your pass again? <a href="${passUrl}" style="color:#ffffff;">Open it here</a>.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
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

export async function sendTrialPassReminder({
  email,
  fullName,
  passUrl,
  applyUrl,
  daysLeft,
  expiresLabel,
  kind = 'application_nudge',
}) {
  if (!email || !passUrl) {
    throw new Error('sendTrialPassReminder requires email and passUrl');
  }
  if (kind === 'application_nudge' && !applyUrl) {
    throw new Error('sendTrialPassReminder application_nudge requires applyUrl');
  }
  let subject;
  if (kind === 'activation_nudge') {
    subject = 'Your Trial SDG Pass is waiting';
  } else {
    const urgent = daysLeft <= 7;
    subject = urgent
      ? `Your Trial SDG Pass ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
      : 'Your Trial SDG Pass is still open';
  }
  return sendEmail({
    to: email,
    subject,
    html: renderTrialReminderHtml({ fullName, passUrl, applyUrl, daysLeft, expiresLabel, kind }),
  });
}

// The first-arrival invite. Fires once, right after a trial guest's first
// successful door scan. Written to feel like a bartender walking over to say
// "you should come back" — the guest just physically had an experience at the
// venue, the moment is warm, and this is the highest-conversion point in the
// trial. Copy leads with the fact that they were HERE (specific), not that
// their trial is running (generic — that's what the reminder cron does on
// days 6, 12, 18, 24).
function renderTrialApplicationInviteHtml({ fullName, applyUrl, passUrl, daysLeft, expiresLabel }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const daysCopy = daysLeft > 0
    ? `You have ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left on your trial — until ${escapeHtml(expiresLabel)}.`
    : `Your trial pass has run out, but we'd still love to have you as a member.`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, glad you came out.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Now that you've seen the place — the sound, the room, the people — this is the moment to become a member. Members get every Friday through Sunday, priority on ticketed events, discounts, and the run of the venue on member-only nights.</p><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">${daysCopy}</p><a href="${applyUrl}" style="display:inline-block;background:#ffb84d;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">APPLY FOR MEMBERSHIP</a><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:8px 0 0 0;">Still using your trial? <a href="${passUrl}" style="color:#ffffff;">Open your pass here</a>.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

export async function sendTrialPassApplicationInvite({ email, fullName, applyUrl, passUrl, daysLeft, expiresLabel }) {
  if (!email || !applyUrl || !passUrl) {
    throw new Error('sendTrialPassApplicationInvite requires email, applyUrl and passUrl');
  }
  return sendEmail({
    to: email,
    subject: `${(fullName || '').split(' ')[0] || 'Thanks'} — become a member of Stardust Garage`,
    html: renderTrialApplicationInviteHtml({ fullName, applyUrl, passUrl, daysLeft, expiresLabel }),
  });
}

// The front-desk companion email. Staff issued the pass in person, so the
// guest already has the pass — this is not a welcome, it is the one thing they
// still have to do. Deliberately short and literal: what they have, what it is
// worth, and the single tap that finishes it. No launch language, no
// exclamation marks, no embellishment; the guest is standing in a venue
// holding a phone and will read exactly one screen of this.
//
// The button is a one-time magic link built by
// buildTrialPassProfileUrl (lib/trial-pass-account.js) — our host, our
// /auth/callback, never a *.supabase.co action_link.
function renderTrialPassProfileInviteHtml({ fullName, profileUrl, passUrl, expiresLabel }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const passLine = passUrl
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:8px 0 0 0;">Need the QR code again? <a href="${passUrl}" style="color:#ffffff;">Open your pass here</a>.</p>`
    : '';
  const expiryLine = expiresLabel
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:16px 0 0 0;">Your QR code is good through ${escapeHtml(expiresLabel)}.</p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, finish your account.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">Your Trial SDG Pass is active. The QR code we sent you gets you in at the door, and your account is set up under this email address.</p><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">While the trial is running you get up to 25% off Weekend Music Experience tickets. The discount applies when you buy while signed in to this account.</p><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;">The button below signs you in — one tap, no password. Add your phone number so the door can find you, and you are done.</p><a href="${profileUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">COMPLETE MY PROFILE</a><p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);margin:16px 0 0 0;">This sign-in link is single-use and expires in 1 hour. You can request a new one any time from the sign-in page.</p>${expiryLine}${passLine}</div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

export async function sendTrialPassProfileInvite({ email, fullName, profileUrl, passUrl = null, expiresLabel = null }) {
  if (!email || !profileUrl) {
    throw new Error('sendTrialPassProfileInvite requires email and profileUrl');
  }
  return sendEmail({
    to: email,
    subject: 'Finish setting up your Stardust Garage account',
    html: renderTrialPassProfileInviteHtml({ fullName, profileUrl, passUrl, expiresLabel }),
  });
}

// ---------------------------------------------------------------------------
// Contract signature request (Event Organizer)
// ---------------------------------------------------------------------------
// This is a NOTICE, not the signing act itself. The legally-binding signing
// link is the one SignNow emails directly to the signer; we deliberately do not
// mint, proxy or forward a signing URL here, and we never link to a storage
// object. The only link in this email is the authenticated portal, which is
// gated by requirePartner(). That keeps the rule "no public contract URLs"
// true by construction: there is nothing in this email a stranger could use.
function renderContractSignatureRequestHtml({
  fullName,
  documentTitle,
  eventLine,
  deadlineLabel,
  portalUrl,
  isReminder,
}) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const safeTitle = escapeHtml(documentTitle || 'Contract');
  const heading = isReminder
    ? `${safeName}, this contract is still waiting.`
    : `${safeName}, you have a contract to sign.`;
  const intro = isReminder
    ? `We haven't received your signature on <strong style="color:#fff;">${safeTitle}</strong> yet.`
    : `Stardust Garage has sent you <strong style="color:#fff;">${safeTitle}</strong> to review and sign.`;
  const eventHtml = eventLine
    ? `<div style="font-size:11px;letter-spacing:0.14em;font-weight:600;color:#888;margin-bottom:8px;">EVENT</div><div style="font-size:14px;color:#fff;">${escapeHtml(eventLine)}</div>`
    : '';
  const deadlineHtml = deadlineLabel
    ? `<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0 0 24px 0;text-align:left;">Please sign by ${escapeHtml(deadlineLabel)}.</p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${heading}</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">${intro}</p>${eventHtml ? `<div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:20px;margin:0 0 24px 0;text-align:left;">${eventHtml}</div>` : ''}<p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 24px 0;text-align:left;">You'll receive a separate email from our e-signature provider with the secure link to sign. It goes to this same address — check your spam folder if you don't see it within a few minutes.</p>${deadlineHtml}<a href="${portalUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;margin-bottom:16px;">VIEW IN MY PORTAL</a><p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);margin:8px 0 0 0;">Questions about the terms? Just reply to this email.</p></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

export async function sendContractSignatureRequest({
  email,
  fullName,
  documentTitle,
  eventLine = null,
  deadlineLabel = null,
  portalUrl,
  isReminder = false,
}) {
  if (!email || !portalUrl) {
    throw new Error('sendContractSignatureRequest requires email and portalUrl');
  }
  const safeTitle = documentTitle || 'Contract';
  return sendEmail({
    to: email,
    subject: isReminder
      ? `Reminder: ${safeTitle} needs your signature`
      : `${safeTitle} — please review and sign`,
    html: renderContractSignatureRequestHtml({
      fullName,
      documentTitle: safeTitle,
      eventLine,
      deadlineLabel,
      portalUrl,
      isReminder,
    }),
  });
}

function renderContractCompletedHtml({ fullName, documentTitle, portalUrl }) {
  const safeName = escapeHtml((fullName || '').split(' ')[0] || 'there');
  const safeTitle = escapeHtml(documentTitle || 'Contract');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;"><div style="max-width:560px;margin:0 auto;background:#141414;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);"><div style="padding:40px 32px 32px 32px;text-align:center;"><div style="font-size:11px;letter-spacing:0.32em;font-weight:600;color:rgba(255,255,255,0.4);margin-bottom:8px;">STARDUST</div><div style="font-size:12px;letter-spacing:0.32em;font-weight:400;color:rgba(255,255,255,0.4);margin-bottom:36px;">GARAGE</div><h1 style="font-size:28px;font-weight:800;margin:0 0 16px 0;letter-spacing:-0.02em;line-height:1.2;color:#ffffff;">${safeName}, we're all signed.</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0 0 32px 0;text-align:left;"><strong style="color:#fff;">${safeTitle}</strong> is fully executed. Our e-signature provider has emailed you the completed copy for your records, and we've filed ours.</p><a href="${portalUrl}" style="display:inline-block;background:#ffffff;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.18em;text-decoration:none;">VIEW IN MY PORTAL</a></div><div style="padding:18px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.35);">hello@sdgatx.com</div></div></body></html>`;
}

export async function sendContractCompleted({ email, fullName, documentTitle, portalUrl }) {
  if (!email || !portalUrl) {
    throw new Error('sendContractCompleted requires email and portalUrl');
  }
  return sendEmail({
    to: email,
    subject: `${documentTitle || 'Your contract'} is fully signed`,
    html: renderContractCompletedHtml({ fullName, documentTitle, portalUrl }),
  });
}

// -------- Internal-ticketing confirmation email ---------------------------
// Rendered from the order + tickets after fulfillment. Each ticket includes
// an inline SVG QR whose payload is the scanner URL. Kept intentionally
// self-contained so we don't couple lib/email.js to lib/tickets/qr.js —
// callers pass an already-rendered svg string per ticket.

// Format an integer cents amount as a currency string ("$12.50", "€9.00").
// USD-only today but honors row.currency so a future international show
// doesn't render "$" over a EUR order. Falls back to a plain amount if
// Intl.NumberFormat is unavailable (server-side Node always has it).
function formatMoneyCents(cents, currency = 'usd') {
  const value = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

// The Stardust Garage brand palette applied everywhere in the ticket
// confirmation email. Kept in one place so we can retune without hunting
// through inline styles. Mirrors app/globals.css CSS custom properties.
const BRAND = {
  cardBg: '#141414',                           // main content surface (over cosmos)
  cardBorder: 'rgba(255,255,255,0.08)',        // subtle white divider
  bgFallback: '#070710',                       // solid color email clients see if the cosmos img is stripped
  textLight: '#f5f5f5',                        // primary text on dark
  textMuted: '#8a8a8a',                        // secondary/caption text
  textDim: '#5a5a5a',                          // tertiary (order ids, footnotes)
  accent: '#ffffff',                           // brand white for CTAs and highlights
  fontBody: `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`,
  fontDisplay: `'Cormorant Garamond','Playfair Display',Georgia,'Times New Roman',serif`,
  fontMono: `'SF Mono',Menlo,Monaco,Consolas,monospace`,
};

// A single ticket row in the confirmation email. The QR image is referenced
// via CID (Content-ID) not inline SVG or data URI, because Gmail, Outlook,
// and Yahoo strip inline <svg> and refuse to render data:image/* in <img>.
// The caller (sendTicketConfirmation) attaches one PNG per ticket with a
// matching Content-ID and this template links them via <img src="cid:...">.
//
// This is the per-ticket ROW (one row = one scannable QR). Product name,
// tier, quantity, and price live on a GROUP HEADER row (see
// renderTicketGroupHeader) rendered once above the batch of tickets that
// share an order_item_id — rendering "Qty 3" on each of 3 identical
// tickets would be misleading.
//
// The QR keeps a WHITE background (not the card background) because QR
// scanners need high contrast between the code modules and their
// surround. A dark background would either kill scannability or require
// inverted-mode QRs that some scanners reject.
function renderTicketRow({ ticketCode, qrCid, viewUrl }) {
  const qrHtml = qrCid
    ? `<img src="cid:${qrCid}" alt="Ticket QR" width="140" height="140" style="display:block;width:140px;height:140px;border:0;background:#ffffff;padding:8px;" />`
    : '';
  return `
    <tr>
      <td style="padding:16px 24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:top;width:156px;padding-right:16px;">
              ${qrHtml}
            </td>
            <td style="vertical-align:top;">
              <div style="font-size:11px;color:${BRAND.textMuted};letter-spacing:0.08em;text-transform:uppercase;">Ticket code</div>
              <div style="font-size:12px;color:${BRAND.textLight};margin-top:4px;font-family:${BRAND.fontMono};word-break:break-all;letter-spacing:0.02em;">${ticketCode}</div>
              ${viewUrl ? `<div style="margin-top:12px;"><a href="${viewUrl}" style="color:${BRAND.textLight};text-decoration:underline;font-size:13px;">Open ticket</a></div>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// One header row per order_item, rendered ONCE above the group of tickets
// that belong to it. Shows the product/tier name, quantity, unit price,
// and line subtotal. Groups without pricing metadata (comp tickets,
// legacy orders) still render a clean header with just the label.
function renderTicketGroupHeader({ productName, tierName, quantity, unitPriceCents, subtotalCents, currency }) {
  const label = tierName ? `${productName} — ${tierName}` : (productName || 'Ticket');
  const qty = Number(quantity) > 0 ? Number(quantity) : null;
  const hasPrice = typeof unitPriceCents === 'number' && Number.isFinite(unitPriceCents);
  const hasSubtotal = typeof subtotalCents === 'number' && Number.isFinite(subtotalCents);
  const qtyPriceParts = [];
  if (qty) qtyPriceParts.push(`${qty} ticket${qty === 1 ? '' : 's'}`);
  // Same: hide "$0.00 each" for comps.
  if (hasPrice && unitPriceCents !== 0) qtyPriceParts.push(`${formatMoneyCents(unitPriceCents, currency)} each`);
  const qtyPriceLine = qtyPriceParts.length
    ? `<div style="font-size:13px;color:${BRAND.textMuted};margin-top:4px;font-family:${BRAND.fontBody};">${qtyPriceParts.join(' · ')}</div>`
    : '';
  // Hide the subtotal cell entirely for comp/free rows so the header
  // isn't cluttered with "$0.00" on giveaways.
  const showSubtotal = hasSubtotal && subtotalCents !== 0;
  const subtotalHtml = showSubtotal
    ? `<td style="vertical-align:top;text-align:right;font-size:15px;color:${BRAND.textLight};font-weight:700;white-space:nowrap;padding-left:12px;font-family:${BRAND.fontBody};">${formatMoneyCents(subtotalCents, currency)}</td>`
    : '';
  return `
    <tr>
      <td style="padding:20px 24px 8px 24px;border-top:1px solid ${BRAND.cardBorder};">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:top;">
              <div style="font-size:16px;color:${BRAND.textLight};font-weight:700;line-height:1.3;font-family:${BRAND.fontBody};">${label}</div>
              ${qtyPriceLine}
            </td>
            ${subtotalHtml}
          </tr>
        </table>
      </td>
    </tr>`;
}

// The order-summary block that renders below the ticket rows: subtotal,
// discount (if applied), fees, tax, and TOTAL PAID in bold. Skipped
// entirely when the caller passes no orderTotals (e.g. comp tickets, or
// legacy tests). Only line-items with a value render — no zero-fee row
// for shows that don't charge processing fees.
function renderOrderTotals(totals, currency) {
  if (!totals) return '';
  const rows = [];
  const line = (label, cents, opts = {}) => {
    if (typeof cents !== 'number' || !Number.isFinite(cents) || cents === 0) return;
    const amount = formatMoneyCents(opts.negate ? -Math.abs(cents) : cents, currency);
    rows.push(`
      <tr>
        <td style="padding:6px 0;font-size:13px;color:${BRAND.textMuted};font-family:${BRAND.fontBody};">${label}</td>
        <td style="padding:6px 0;font-size:13px;color:${BRAND.textLight};text-align:right;font-family:${BRAND.fontBody};">${amount}</td>
      </tr>`);
  };
  line('Subtotal', totals.subtotalCents);
  line('Discount', totals.discountCents, { negate: true });
  line('Fees', totals.feesCents);
  line('Tax', totals.taxCents);
  const totalLabel = 'Total paid';
  const totalAmount = formatMoneyCents(totals.totalCents || 0, currency);
  if (rows.length === 0 && !totals.totalCents) return ''; // fully free / comp
  return `
    <tr><td style="padding:16px 24px 20px 24px;border-top:1px solid ${BRAND.cardBorder};">
      <table role="presentation" style="width:100%;max-width:300px;margin-left:auto;border-collapse:collapse;">
        ${rows.join('')}
        <tr>
          <td style="padding:12px 0 0 0;font-size:15px;color:${BRAND.textLight};font-weight:700;border-top:1px solid ${BRAND.cardBorder};font-family:${BRAND.fontBody};letter-spacing:0.04em;text-transform:uppercase;">${totalLabel}</td>
          <td style="padding:12px 0 0 0;font-size:16px;color:${BRAND.accent};font-weight:800;text-align:right;border-top:1px solid ${BRAND.cardBorder};font-family:${BRAND.fontBody};">${totalAmount}</td>
        </tr>
      </table>
    </td></tr>`;
}

// Confirmation email sent when a ticket order is paid, or resent from the
// admin panel / the account ticket hub. Parameters:
//
//   to             Recipient email (required)
//   orderId        Order UUID for the small "Order ..." footer line
//   orderDate      ISO-ish string; formatted human-readable if provided
//   eventTitle     Show name
//   eventWhen      Human-readable event date/time line
//   eventFlyerUrl  Absolute URL to the event flyer image; renders as a
//                  600-wide hero at the top if provided, omitted cleanly
//                  otherwise (comp tickets, older orders, etc.)
//   venueAddress   Street address rendered under the event date. Constant
//                  today (Stardust is single-venue) but passed in so a
//                  future multi-venue schema can override per-order.
//   ticketRows     Array of {ticketCode, productName, tierName, qrSvg,
//                  viewUrl} — exactly what renderTicketRow expects.
//   orderUrl       Deep link to the order in the ticket hub. Rendered as a
//                  white pill CTA ("VIEW IN YOUR ACCOUNT") in addition to the
//                  existing plain text link, so the account page is the
//                  primary action even from a plain-text email client.
export async function sendTicketConfirmation({
  to,
  orderId,
  orderDate,
  eventTitle,
  eventWhen,
  eventFlyerUrl,
  venueAddress,
  ticketRows,
  orderUrl,
  orderTotals, // optional { subtotalCents, feesCents, taxCents, discountCents, totalCents }
  currency,    // optional order currency, defaults to 'usd'
}) {
  if (!to) return null;

  // Build one CID attachment per ticket whose row has a qrPngBuffer. CIDs
  // are stable per-ticket-code so the same code seen twice (defensive)
  // produces the same reference. Empty/missing buffers just render the
  // row without an image (no broken-image icon) rather than crashing.
  const attachments = [];
  const rowsForRender = ticketRows.map((row) => {
    const buf = row.qrPngBuffer;
    if (!buf) return { ...row, qrCid: null };
    const safeCode = String(row.ticketCode || 'ticket').replace(/[^A-Za-z0-9._-]/g, '');
    const contentId = `qr-${safeCode}@sdgatx`;
    const filename = `${safeCode || 'ticket'}.png`;
    attachments.push({
      filename,
      content: buf,
      content_id: contentId,
      content_type: 'image/png',
    });
    return { ...row, qrCid: contentId };
  });
  // Group ticket rows by their line item (product + tier + unit price)
  // so we render ONE header per line with the quantity and price, then
  // the individual tickets underneath. Falls back gracefully when rows
  // don't carry pricing (older comp callers): each row becomes its own
  // group and the header just shows the product name.
  const groups = [];
  const indexByKey = new Map();
  for (const row of rowsForRender) {
    const key = [
      row.productName || 'Ticket',
      row.tierName || '',
      row.unitPriceCents ?? '',
      row.subtotalCents ?? '',
    ].join('|');
    let idx = indexByKey.get(key);
    if (idx == null) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({
        header: {
          productName: row.productName,
          tierName: row.tierName,
          quantity: row.quantity ?? null,
          unitPriceCents: row.unitPriceCents ?? null,
          subtotalCents: row.subtotalCents ?? null,
          currency: row.currency || currency,
        },
        tickets: [],
      });
    }
    groups[idx].tickets.push(row);
  }
  const rowsHtml = groups
    .map((g) => renderTicketGroupHeader(g.header) + g.tickets.map(renderTicketRow).join(''))
    .join('');
  const totalsHtml = renderOrderTotals(orderTotals, currency);

  // Brand hero: cosmos band + white wordmark baked into one PNG and CID-
  // attached. Every mainstream email client renders a single <img> tag, so
  // this delivers the branded header reliably without inline SVG, CSS
  // gradients, or Outlook-only VML fallbacks. Rendered once per process;
  // failure degrades to a solid dark bar with plain "STARDUST GARAGE" text.
  let heroCid = null;
  try {
    const heroBuf = await getHeroPngBuffer();
    heroCid = 'hero@sdgatx';
    attachments.push({
      filename: 'stardust-hero.png',
      content: heroBuf,
      content_id: heroCid,
      content_type: 'image/png',
    });
  } catch (err) {
    console.warn('[ticket-email] hero render failed, falling back to text header:', err?.message);
  }

  let orderDateHtml = '';
  if (orderDate) {
    let formatted = orderDate;
    try {
      const d = new Date(orderDate);
      if (!Number.isNaN(d.getTime())) {
        formatted = d.toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        });
      }
    } catch { /* keep raw */ }
    orderDateHtml = `<div style="font-size:12px;color:${BRAND.textDim};margin-top:4px;font-family:${BRAND.fontBody};">Ordered ${formatted}</div>`;
  }

  const addressHtml = venueAddress
    ? `<div style="font-size:13px;color:${BRAND.textMuted};margin-top:6px;font-family:${BRAND.fontBody};">${venueAddress}</div>`
    : '';

  // CTA pill: white outline on dark, matches the site's ghost buttons.
  const ctaHtml = orderUrl
    ? `<div style="margin-top:20px;">
         <a href="${orderUrl}" style="display:inline-block;padding:12px 24px;background:transparent;color:${BRAND.accent};border:1px solid ${BRAND.accent};border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-decoration:none;font-family:${BRAND.fontBody};text-transform:uppercase;">View in your account</a>
       </div>`
    : '';

  // Hero row: single 600×300 PNG (cosmos + wordmark) as one <img>. The
  // fallback path renders a solid-black band with the wordmark set as
  // uppercase text so screen readers, Outlook, and image-blocked inboxes
  // still see clear brand identification.
  const heroHtml = heroCid
    ? `<tr><td style="padding:0;background:${BRAND.bgFallback};line-height:0;font-size:0;">
         <img src="cid:${heroCid}" alt="Stardust Garage" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
       </td></tr>`
    : `<tr><td style="padding:64px 24px;background:${BRAND.bgFallback};text-align:center;">
         <div style="font-family:${BRAND.fontBody};font-size:16px;color:${BRAND.accent};letter-spacing:0.32em;text-transform:uppercase;font-weight:700;">Stardust Garage</div>
       </td></tr>`;

  // Google Fonts <link> is included but every color-critical style also
  // supplies a system-font fallback in BRAND.fontBody. Outlook 2019+
  // desktop ignores the link and uses Segoe UI — close enough.
  const html = `<!DOCTYPE html><html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <!-- Tell Gmail (iOS/Android/webmail) and Apple Mail that this email is
         already designed for a dark palette so they do NOT auto-invert
         our dark card into light-grey. Without these, Gmail on a device
         in dark mode flips #141414 → near-white, breaking the branding. -->
    <meta name="color-scheme" content="dark light" />
    <meta name="supported-color-schemes" content="dark light" />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>
      :root { color-scheme: dark light; supported-color-schemes: dark light; }
    </style>
    <title>Your Stardust Garage tickets</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bgFallback};font-family:${BRAND.fontBody};color:${BRAND.textLight};">
    <div style="display:none;font-size:1px;color:${BRAND.bgFallback};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">You're in — ${eventTitle || 'Stardust Garage'}. Your QR tickets are inside.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.bgFallback};">
      <tr><td align="center" style="padding:0;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:${BRAND.cardBg};max-width:600px;border:1px solid ${BRAND.cardBorder};">
          ${heroHtml}
          ${eventFlyerUrl ? `<tr><td style="padding:0;background:${BRAND.cardBg};line-height:0;font-size:0;"><img src="${eventFlyerUrl}" alt="${eventTitle ? escapeHtml(eventTitle) : ''}" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>` : ''}
          <tr><td style="padding:28px 24px 28px 24px;text-align:center;background:${BRAND.cardBg};">
            <div style="font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.24em;font-family:${BRAND.fontBody};">You're in</div>
            <div style="font-family:${BRAND.fontDisplay};font-size:36px;color:${BRAND.textLight};font-weight:600;line-height:1.15;margin-top:10px;font-style:italic;letter-spacing:-0.01em;">${eventTitle || ''}</div>
            ${eventWhen ? `<div style="font-size:14px;color:${BRAND.textLight};margin-top:12px;font-family:${BRAND.fontBody};letter-spacing:0.04em;">${eventWhen}</div>` : ''}
            ${addressHtml}
            ${ctaHtml}
            <div style="font-size:11px;color:${BRAND.textDim};margin-top:22px;font-family:${BRAND.fontMono};letter-spacing:0.06em;">Order ${orderId}</div>
            ${orderDateHtml}
          </td></tr>
          <tr><td style="background:${BRAND.cardBg};">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rowsHtml}</table>
          </td></tr>
          ${totalsHtml}
          <tr><td style="padding:24px;border-top:1px solid ${BRAND.cardBorder};background:${BRAND.cardBg};font-size:13px;color:${BRAND.textMuted};line-height:1.6;font-family:${BRAND.fontBody};">
            Show the QR at the door. Each code is single-use. If your plans change, reach us at <a href="mailto:hello@sdgatx.com" style="color:${BRAND.textLight};">hello@sdgatx.com</a>.
            ${orderUrl ? `<div style="margin-top:14px;"><a href="${orderUrl}" style="color:${BRAND.textLight};text-decoration:underline;">View this order online</a></div>` : ''}
          </td></tr>
          <tr><td style="padding:20px 24px 32px 24px;text-align:center;border-top:1px solid ${BRAND.cardBorder};background:${BRAND.cardBg};">
            <div style="font-family:${BRAND.fontBody};font-size:10px;color:${BRAND.textDim};letter-spacing:0.28em;text-transform:uppercase;">Stardust Garage · Austin, TX</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
  return sendEmail({
    to,
    subject: `Your Stardust Garage tickets — ${eventTitle}`,
    html,
    attachments,
  });
}
