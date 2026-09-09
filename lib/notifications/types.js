// Notification type catalog.
//
// Every notification the system can send is declared here. The catalog is
// the source of truth for:
//
//   - Which channels a type defaults to (in_app / push / email). Users can
//     override per-type in their settings page; absence of an override falls
//     back to these defaults.
//
//   - The human-readable category the type belongs to (used to group toggles
//     on the settings page).
//
//   - Whether the type has a matching email template. If not, the sender's
//     email step is a no-op even when the user has email on for the type.
//
//   - A short human label + description shown on the settings page.
//
// To add a new notification type: add an entry here and start calling
// notify(admin, { userId, type: 'your_new_type', ...payload }) from wherever
// the event happens. No other wiring needed for the in-app feed; email needs
// a matching send function in lib/email.js if requiresEmail is true.

export const CATEGORIES = {
  TICKET: 'ticket',
  EVENT: 'event',
  MEMBERSHIP: 'membership',
  TRIAL: 'trial',
  DOOR: 'door',
  STAFF: 'staff',
  ADMIN: 'admin',
  MARKETING: 'marketing',
};

export const CATEGORY_LABELS = {
  ticket: 'Tickets',
  event: 'Events',
  membership: 'Membership',
  trial: 'Trial pass',
  door: 'Door activity',
  staff: 'Staff',
  admin: 'Admin alerts',
  marketing: 'Announcements',
};

// The type catalog itself. Keep type ids snake_case and stable \u2014 they get
// written to notification_preferences.type, changing an id would orphan
// existing opt-out rows.
export const NOTIFICATION_TYPES = {
  // ===================== TICKETS =====================
  ticket_ready: {
    id: 'ticket_ready',
    category: CATEGORIES.TICKET,
    label: 'Your ticket is ready',
    description: 'After you buy a ticket, we send you the QR + event details.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false, // essential \u2014 people need their tickets
  },
  ticket_event_updated: {
    id: 'ticket_event_updated',
    category: CATEGORIES.TICKET,
    label: 'Event details changed',
    description: 'The date, time, lineup, or venue of an event you have a ticket to changed.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false, // essential \u2014 you need to know if your event moved
  },
  ticket_event_cancelled: {
    id: 'ticket_event_cancelled',
    category: CATEGORIES.TICKET,
    label: 'Event cancelled',
    description: 'An event you have a ticket to has been cancelled.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  ticket_refund_issued: {
    id: 'ticket_refund_issued',
    category: CATEGORIES.TICKET,
    label: 'Refund issued',
    description: 'A refund on one of your ticket purchases was processed.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  ticket_event_tomorrow: {
    id: 'ticket_event_tomorrow',
    category: CATEGORIES.TICKET,
    label: 'Event tomorrow',
    description: '24h before an event you have a ticket to, we remind you.',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: true,
  },
  ticket_event_soon: {
    id: 'ticket_event_soon',
    category: CATEGORIES.TICKET,
    label: 'Event in a few hours',
    description: '2h before an event you have a ticket to, we remind you.',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: true,
  },

  // ===================== EVENTS (site-wide) =====================
  event_published: {
    id: 'event_published',
    category: CATEGORIES.EVENT,
    label: 'New event announced',
    description: 'A new SDG event was just posted to the public page.',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: true,
  },
  event_member_presale_open: {
    id: 'event_member_presale_open',
    category: CATEGORIES.EVENT,
    label: 'Member pre-sale is open',
    description: 'Members can buy tickets before the public. We ping you when it opens.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: true,
    memberOnly: true,
  },

  // ===================== MEMBERSHIP LIFECYCLE =====================
  member_welcome: {
    id: 'member_welcome',
    category: CATEGORIES.MEMBERSHIP,
    label: 'Welcome to Stardust Garage',
    description: 'Sent once when your membership starts.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  member_renewal_upcoming: {
    id: 'member_renewal_upcoming',
    category: CATEGORIES.MEMBERSHIP,
    label: 'Renewal in 3 days',
    description: 'Heads-up before your card is charged.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false, // billing surprises are user-hostile
  },
  member_payment_failed: {
    id: 'member_payment_failed',
    category: CATEGORIES.MEMBERSHIP,
    label: 'Payment failed',
    description: 'We couldn\u2019t charge your card \u2014 update it to keep your membership.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  member_expiring: {
    id: 'member_expiring',
    category: CATEGORIES.MEMBERSHIP,
    label: 'Membership expiring in 7 days',
    description: 'Reminder before your membership ends.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: true,
  },

  // ===================== TRIAL PASS =====================
  trial_activated: {
    id: 'trial_activated',
    category: CATEGORIES.TRIAL,
    label: 'Trial pass activated',
    description: 'Sent when you first walk in on your trial pass \u2014 the 30-day clock starts.',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: false,
  },
  trial_ending_soon: {
    id: 'trial_ending_soon',
    category: CATEGORIES.TRIAL,
    label: 'Trial ending in 7 days',
    description: '7-day heads-up before your trial pass expires.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  trial_ending_tomorrow: {
    id: 'trial_ending_tomorrow',
    category: CATEGORIES.TRIAL,
    label: 'Trial ending tomorrow',
    description: 'Last chance to apply for full membership.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  trial_application_received: {
    id: 'trial_application_received',
    category: CATEGORIES.TRIAL,
    label: 'Application received',
    description: 'We got your membership application \u2014 we\u2019ll follow up shortly.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },
  trial_membership_approved: {
    id: 'trial_membership_approved',
    category: CATEGORIES.TRIAL,
    label: 'You\u2019re in',
    description: 'Sent when your membership application is approved.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },

  // ===================== DOOR ACTIVITY =====================
  door_checkin: {
    id: 'door_checkin',
    category: CATEGORIES.DOOR,
    label: 'Checked in at the door',
    description: 'Silent confirmation in your feed after door staff scans you in.',
    defaultChannels: { in_app: true, push: false, email: false },
    requiresEmail: false,
    userConfigurable: true,
  },

  // ===================== CONTRACTS =====================
  contract_signed: {
    id: 'contract_signed',
    category: CATEGORIES.ADMIN,
    label: 'Contract completed',
    description: 'A contract you signed has been countersigned and is complete.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: false,
  },

  // ===================== STAFF / OWNER ALERTS =====================
  staff_door_scan_denied: {
    id: 'staff_door_scan_denied',
    category: CATEGORIES.STAFF,
    label: 'Door scan denied',
    description: 'On-duty staff get pinged when a door scan is refused (photo mismatch, wrong event, etc).',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: true,
    role: 'staff',
  },
  staff_capacity_threshold: {
    id: 'staff_capacity_threshold',
    category: CATEGORIES.STAFF,
    label: 'Capacity threshold hit',
    description: 'When an event hits 80% or 100% of capacity, staff and owner get pinged.',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: true,
    role: 'staff',
  },
  admin_member_application: {
    id: 'admin_member_application',
    category: CATEGORIES.ADMIN,
    label: 'New membership application',
    description: 'Owner alert when a trial-pass holder applies for full membership.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: true,
    role: 'admin',
  },
  admin_refund_requested: {
    id: 'admin_refund_requested',
    category: CATEGORIES.ADMIN,
    label: 'Refund requested',
    description: 'Owner alert when a customer requests a refund.',
    defaultChannels: { in_app: true, push: true, email: true },
    requiresEmail: true,
    userConfigurable: true,
    role: 'admin',
  },
  admin_ticket_sold: {
    id: 'admin_ticket_sold',
    category: CATEGORIES.ADMIN,
    label: 'Ticket sold',
    description: 'In-app-only alert on the admin dashboard when a ticket sells.',
    defaultChannels: { in_app: true, push: false, email: false },
    requiresEmail: false,
    userConfigurable: true,
    role: 'admin',
  },

  // ===================== MARKETING =====================
  marketing_broadcast: {
    id: 'marketing_broadcast',
    category: CATEGORIES.MARKETING,
    label: 'SDG announcements',
    description: 'One-off messages from Stardust Garage (last-minute tickets, doors open tonight, etc).',
    defaultChannels: { in_app: true, push: true, email: false },
    requiresEmail: false,
    userConfigurable: true,
  },
};

export function getType(typeId) {
  return NOTIFICATION_TYPES[typeId] || null;
}

export function listTypes({ role = null, includeAdmin = false } = {}) {
  return Object.values(NOTIFICATION_TYPES).filter((t) => {
    if (!t.role) return true;
    if (t.role === 'staff' || t.role === 'admin') {
      return includeAdmin || role === t.role || role === 'admin';
    }
    return true;
  });
}

export function listUserConfigurableTypes({ role = null, includeAdmin = false } = {}) {
  return listTypes({ role, includeAdmin }).filter((t) => t.userConfigurable);
}

// Compute effective channels for (user, type) given a preference override
// row (may be null). Never mutates. Returns { in_app, push, email }.
export function effectiveChannels(typeId, prefRow) {
  const type = getType(typeId);
  if (!type) return { in_app: false, push: false, email: false };
  const defaults = type.defaultChannels;
  if (!prefRow) return { ...defaults };
  // in_app is always on regardless of pref \u2014 the feed is source of truth,
  // opting out would silently drop confirmations the user might need to see
  // later. We keep the column so we can respect it in a future release.
  return {
    in_app: true,
    push: type.userConfigurable ? Boolean(prefRow.push) : defaults.push,
    email: type.userConfigurable ? Boolean(prefRow.email) : defaults.email,
  };
}
