// Submission conversations: one private thread between the SDG team and the
// person behind a Venue Inquiry, Micro Party, Collaboration or Membership
// Application. Server-only. Every rule lives here, never in the browser:
//
//   - Only admins (requireAdminMfa) invite, write as the team, close/reopen,
//     or delete team messages. Author identity comes from team_members.
//   - A submitter reaches a thread only through their own signed-in Stardust
//     account. An invite link attaches the thread to an account ONLY when the
//     account's email matches the invited email; the raw link token is never
//     stored (SHA-256 hash only) and expires after 60 days.
//   - Membership applications already carry a verified applicant account, so
//     those threads attach immediately with no link to claim.
//   - The team can mark a message as a Question. The submitter answers it
//     inline; an answer is a guest message whose reply_to_id is the question.
//   - Closed threads are read-only for the submitter.
//   - The submitter only ever sees "SDG Team" as the author of team messages
//     (in the app, push and email), never which teammate wrote it, and never
//     whether or when the team read their messages. Teammate names and team
//     read state exist only in admin views.
//   - Team Notes (lib/submission-notes.js) stay internal and separate.
//
// Delivery is best effort: a failed email or push never undoes a saved
// message. The thread itself is the record.

import { createHash, randomBytes } from 'node:crypto';

export const CONVERSATION_TYPES = new Set(['applications', 'collaborations', 'micro-parties', 'venue-inquiries', 'date-pitches']);
export const MESSAGE_MAX_LENGTH = 5000;
export const INVITE_TTL_DAYS = 60;
export const TEAM_DISPLAY_NAME = 'SDG Team';

const TYPE_META = {
  'venue-inquiries': {
    table: 'venue_inquiries',
    label: 'Venue rental inquiry',
    routeBase: '/bananas/venue-inquiries',
    columns: 'id, status, full_name, email, event_name, event_type, created_at',
    subject: (r) => r.event_name || r.event_type || 'Venue rental inquiry',
  },
  'micro-parties': {
    table: 'micro_party_inquiries',
    label: 'Micro party inquiry',
    routeBase: '/bananas/micro-parties',
    columns: 'id, status, full_name, email, event_name, event_type, created_at',
    subject: (r) => r.event_name || r.event_type || 'Micro party inquiry',
  },
  collaborations: {
    table: 'collaborations',
    label: 'Collaboration',
    routeBase: '/bananas/collaborations',
    columns: 'id, status, full_name, email, collaborator_type, applying_for, company, created_at',
    subject: (r) => {
      const what = r.applying_for || r.collaborator_type;
      return what ? `Collaboration: ${what}` : 'Collaboration';
    },
  },
  applications: {
    table: 'membership_applications',
    label: 'Membership application',
    routeBase: '/bananas/applications',
    columns: 'id, status, full_name, preferred_name, email, plan, applicant_user_id, created_at',
    subject: (r) => 'Membership application',
  },
  // Programmer date pitches carry the submitting account, so a conversation
  // attaches to the Programmer's login immediately.
  'date-pitches': {
    table: 'date_pitches',
    label: 'Date pitch',
    routeBase: '/bananas/date-pitches',
    columns: 'id, status, full_name, email, title, pitch_date, applicant_user_id, created_at',
    subject: (r) => `${r.title || 'Date pitch'} · ${r.pitch_date || ''}`.replace(/ · $/, ''),
  },
};

const THREAD_COLUMNS = 'id, submission_type, submission_id, subject, invite_email, participant_user_id, participant_name, status, created_at, invited_at, claimed_at, closed_at, last_team_message_at, last_guest_message_at, team_last_read_at, guest_last_read_at, awaiting_team, unread_by_guest';
const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_id, author_name, kind, reply_to_id, body, created_at, deleted_at';

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function conversationTypeMeta(type) {
  return TYPE_META[type] || null;
}

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeMessageBody(raw) {
  if (typeof raw !== 'string') return { error: 'Message text is required.' };
  const body = raw.replace(/\r\n/g, '\n').trim();
  if (!body) return { error: 'Message can\u2019t be empty.' };
  if (body.length > MESSAGE_MAX_LENGTH) return { error: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters.` };
  return { body };
}

export function newInviteToken() {
  return randomBytes(24).toString('base64url');
}

export function hashInviteToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function isInviteTokenShape(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(token);
}

// "jane.doe@gmail.com" -> "ja•••@gmail.com". Shown to someone signed in with
// the wrong account so they know which inbox the invite went to without the
// page disclosing the full address.
export function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at < 1) return '';
  const local = value.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}\u2022\u2022\u2022${value.slice(at)}`;
}

export function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

// A Question is open until the submitter answers it.
export function openQuestionIds(messages) {
  const answered = new Set(
    messages.filter((m) => m.author_kind === 'guest' && m.reply_to_id && !m.deleted_at).map((m) => m.reply_to_id),
  );
  return messages
    .filter((m) => m.kind === 'question' && !m.deleted_at && !answered.has(m.id))
    .map((m) => m.id);
}

// Shape for the browser. `viewer` is { kind: 'team'|'guest', id, isOwner }.
export function presentMessage(row, viewer) {
  const mine = Boolean(viewer?.id && row.author_id === viewer.id);
  const teamAuthorName = viewer?.kind === 'team' ? row.author_name || TEAM_DISPLAY_NAME : TEAM_DISPLAY_NAME;
  return {
    id: row.id,
    author_kind: row.author_kind,
    // Submitters never learn which teammate wrote a message.
    author_name: row.author_kind === 'team' ? teamAuthorName : row.author_name || 'Guest',
    kind: row.kind,
    reply_to_id: row.reply_to_id || null,
    body: row.body,
    created_at: row.created_at,
    is_mine: mine,
    can_delete: viewer?.kind === 'team' && row.author_kind === 'team' && (mine || Boolean(viewer?.isOwner)),
  };
}

export function presentThreadForTeam(thread) {
  if (!thread) return null;
  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    invite_email: thread.invite_email,
    joined: Boolean(thread.participant_user_id),
    participant_name: thread.participant_name || null,
    invited_at: thread.invited_at,
    claimed_at: thread.claimed_at,
    closed_at: thread.closed_at,
    last_team_message_at: thread.last_team_message_at,
    last_guest_message_at: thread.last_guest_message_at,
    awaiting_team: Boolean(thread.awaiting_team),
    guest_last_read_at: thread.guest_last_read_at,
  };
}

export function presentThreadForGuest(thread, submission) {
  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    type_label: TYPE_META[thread.submission_type]?.label || 'Submission',
    submitted_at: submission?.created_at || null,
    unread: Boolean(thread.unread_by_guest),
    last_activity_at: latest(thread.last_team_message_at, thread.last_guest_message_at) || thread.created_at,
  };
}

function latest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

// Submission status follows the conversation: the first team message on a
// New or Seen submission marks it Contacted, which is what that status means.
export function statusAfterFirstContact(currentStatus) {
  const s = currentStatus || 'new';
  return s === 'new' || s === 'seen' ? 'contacted' : null;
}

// ---------------------------------------------------------------------------
// Default dependencies (overridable in tests)
// ---------------------------------------------------------------------------

async function defaultRequireAdminMfa() {
  const mod = await import('./auth-helpers.js');
  return mod.requireAdminMfa();
}
async function defaultCreateAdminClient() {
  const mod = await import('./supabase/admin.js');
  return mod.createAdminClient();
}
async function defaultOwnerEmail() {
  const mod = await import('./auth-helpers.js');
  return mod.OWNER_EMAIL;
}
async function defaultGetUser(request) {
  const mod = await import('./auth-helpers.js');
  if (request) return mod.getRequestUser(request);
  const { user } = await mod.getCurrentUser();
  return user || null;
}
async function defaultSiteUrl(request) {
  const mod = await import('./site-url.js');
  return mod.resolveSiteUrl(request);
}
async function defaultFindAccount(admin, email) {
  const mod = await import('./trial-pass-account.js');
  return mod.findAuthUserByEmail(admin, email);
}
async function defaultNotify(admin, opts) {
  const mod = await import('./notifications/send.js');
  return mod.notify(admin, opts);
}
async function defaultAdminAudience(admin) {
  const mod = await import('./notifications/audience.js');
  return mod.resolveAudience(admin, { scope: 'admin' });
}
async function defaultEmail() {
  const mod = await import('./email.js');
  return { sendConversationInvite: mod.sendConversationInvite, sendConversationMessage: mod.sendConversationMessage };
}

function nowIso(deps) {
  return (deps.now ? deps.now() : new Date()).toISOString();
}

async function authorizeTeam(deps) {
  const result = await (deps.requireAdminMfa || defaultRequireAdminMfa)();
  if (result.unauthorized || !result.user) {
    return { error: { status: 401, body: { error: 'Unauthorized', reason: result.reason || null } } };
  }
  const ownerEmail = deps.ownerEmail || (await defaultOwnerEmail());
  const email = (result.user.email || '').toLowerCase();
  return { viewer: { kind: 'team', id: result.user.id, email: result.user.email, isOwner: email === ownerEmail.toLowerCase() } };
}

async function authorizeGuest(deps, request) {
  const user = await (deps.getUser || defaultGetUser)(request);
  if (!user?.id) return { error: { status: 401, body: { error: 'Sign in to view your messages.' } } };
  return { user, viewer: { kind: 'guest', id: user.id } };
}

async function teamAuthor(supabase, viewer) {
  const { data } = await supabase.from('team_members').select('email, full_name').eq('user_id', viewer.id).maybeSingle();
  return { name: data?.full_name || null, email: data?.email || viewer.email };
}

async function loadSubmission(supabase, type, id) {
  const meta = TYPE_META[type];
  if (!meta) return { error: { status: 404, body: { error: 'Unknown submission type.' } } };
  const { data, error } = await supabase.from(meta.table).select(meta.columns).eq('id', id).maybeSingle();
  if (error) return { error: { status: 400, body: { error: error.message } } };
  if (!data) return { error: { status: 404, body: { error: 'Submission not found.' } } };
  return {
    submission: {
      ...data,
      name: data.preferred_name || data.full_name || '',
      subject: meta.subject(data).slice(0, 200),
      typeLabel: meta.label,
      table: meta.table,
    },
  };
}

async function loadThreadForSubmission(supabase, type, id) {
  const { data, error } = await supabase
    .from('submission_threads')
    .select(THREAD_COLUMNS)
    .eq('submission_type', type)
    .eq('submission_id', id)
    .maybeSingle();
  if (error) return { error: { status: 400, body: { error: error.message } } };
  return { thread: data || null };
}

async function loadMessages(supabase, threadId, { includeDeleted = false } = {}) {
  let q = supabase.from('submission_thread_messages').select(MESSAGE_COLUMNS).eq('thread_id', threadId);
  if (!includeDeleted) q = q.is('deleted_at', null);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(500);
  if (error) return { error: { status: 400, body: { error: error.message } } };
  return { messages: data || [] };
}

async function mintInvite(supabase, { threadId, email, viewer, deps }) {
  const token = (deps.newInviteToken || newInviteToken)();
  const expires = new Date((deps.now ? deps.now() : new Date()).getTime() + INVITE_TTL_DAYS * 86400000).toISOString();
  const { error } = await supabase.from('submission_thread_invites').insert({
    thread_id: threadId,
    token_hash: hashInviteToken(token),
    email,
    created_by: viewer.id,
    expires_at: expires,
  });
  if (error) return { error: { status: 400, body: { error: error.message } } };
  return { token };
}

// Delivers a team message (or the bare invite) to the submitter. Linked
// threads go through notify() (in-app + push + email per their settings);
// unlinked threads get an email carrying a fresh invite link.
async function deliverToGuest(supabase, { thread, submission, message, viewer, author, request, deps }) {
  const site = await (deps.siteUrl || defaultSiteUrl)(request);
  const emails = deps.email || (await defaultEmail());
  const isQuestion = message?.kind === 'question';
  try {
    if (thread.participant_user_id) {
      const url = `${site}/account/messages/${thread.id}`;
      await (deps.notify || defaultNotify)(supabase, {
        userId: thread.participant_user_id,
        type: 'conversation_message',
        title: isQuestion ? 'SDG Team asked you a question' : 'New message from SDG Team',
        body: thread.subject,
        data: { thread_id: thread.id, url: `/account/messages/${thread.id}` },
        email: {
          send: () => emails.sendConversationMessage({
            email: thread.invite_email,
            fullName: thread.participant_name || submission.name,
            subject: thread.subject,
            messageBody: message?.body || null,
            isQuestion,
            url,
          }),
        },
      });
      return { delivered: 'account' };
    }
    const minted = await mintInvite(supabase, { threadId: thread.id, email: thread.invite_email, viewer, deps });
    if (minted.error) return { delivered: 'failed', error: minted.error.body.error };
    let hasAccount = false;
    try {
      hasAccount = Boolean(await (deps.findAccount || defaultFindAccount)(supabase, thread.invite_email));
    } catch {
      hasAccount = false;
    }
    await emails.sendConversationInvite({
      email: thread.invite_email,
      fullName: submission.name,
      subject: thread.subject,
      typeLabel: submission.typeLabel,
      messageBody: message?.body || null,
      isQuestion,
      url: `${site}/inbox/${minted.token}`,
      hasAccount,
    });
    return { delivered: 'email' };
  } catch (err) {
    console.error('[conversations.deliver]', err?.message || err);
    return { delivered: 'failed', error: 'Saved, but the email could not be sent.' };
  }
}

async function markContacted(supabase, submission) {
  const next = statusAfterFirstContact(submission.status);
  if (!next) return;
  const { error } = await supabase
    .from(submission.table)
    .update({ status: next })
    .eq('id', submission.id)
    .in('status', ['new', 'seen']);
  if (error) console.error('[conversations.markContacted]', error.message);
}

async function teamConversationBody(supabase, { submission, thread, viewer, deps }) {
  let account = null;
  if (!thread) {
    if (submission.applicant_user_id) account = { exists: true, linked: true };
    else {
      try {
        account = { exists: Boolean(await (deps.findAccount || defaultFindAccount)(supabase, submission.email)), linked: false };
      } catch {
        account = { exists: null, linked: false };
      }
    }
  }
  let messages = [];
  if (thread) {
    const loaded = await loadMessages(supabase, thread.id);
    if (loaded.error) return loaded.error;
    messages = loaded.messages;
  }
  const open = new Set(openQuestionIds(messages));
  return {
    body: {
      submission: { type: submission.type, id: submission.id, name: submission.name, email: submission.email, subject: submission.subject, type_label: submission.typeLabel },
      account,
      thread: presentThreadForTeam(thread),
      messages: messages.map((m) => ({ ...presentMessage(m, viewer), open_question: open.has(m.id) })),
    },
  };
}

// ---------------------------------------------------------------------------
// Team (admin) operations
// ---------------------------------------------------------------------------

export async function getTeamConversation({ type, id, markRead = true, deps = {} }) {
  if (!CONVERSATION_TYPES.has(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorizeTeam(deps);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const loaded = await loadSubmission(supabase, type, id);
  if (loaded.error) return loaded.error;
  const submission = { ...loaded.submission, type };
  const { thread, error: tErr } = await loadThreadForSubmission(supabase, type, id);
  if (tErr) return tErr;
  if (thread && markRead && thread.awaiting_team) {
    const at = nowIso(deps);
    await supabase.from('submission_threads').update({ team_last_read_at: at }).eq('id', thread.id);
    thread.team_last_read_at = at;
    thread.awaiting_team = false;
  }
  const result = await teamConversationBody(supabase, { submission, thread, viewer, deps });
  if (result.status) return result;
  return { status: 200, body: result.body };
}

// Creates the thread (once per submission), optionally with an opening
// message, and sends the invite. Calling it again resends the invite; passing
// a different email before the person has joined re-targets the invite and
// revokes earlier links.
export async function inviteToConversation({ type, id, rawEmail, rawBody, kind = 'message', request = null, deps = {} }) {
  if (!CONVERSATION_TYPES.has(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorizeTeam(deps);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const loaded = await loadSubmission(supabase, type, id);
  if (loaded.error) return loaded.error;
  const submission = { ...loaded.submission, type };

  const email = normalizeEmail(rawEmail ?? submission.email);
  if (!email) return { status: 400, body: { error: 'Enter a valid email address for the invite.' } };

  let opening = null;
  if (typeof rawBody === 'string' && rawBody.trim()) {
    const parsed = normalizeMessageBody(rawBody);
    if (parsed.error) return { status: 400, body: { error: parsed.error } };
    opening = parsed.body;
  }
  const messageKind = kind === 'question' ? 'question' : 'message';

  const { thread: existing, error: tErr } = await loadThreadForSubmission(supabase, type, id);
  if (tErr) return tErr;
  const author = await teamAuthor(supabase, viewer);
  const at = nowIso(deps);
  let thread = existing;

  if (!thread) {
    // Applications already have the applicant's verified account.
    const linked = submission.applicant_user_id && email === normalizeEmail(submission.email);
    const { data, error: insErr } = await supabase
      .from('submission_threads')
      .insert({
        submission_type: type,
        submission_id: id,
        subject: submission.subject,
        invite_email: email,
        participant_user_id: linked ? submission.applicant_user_id : null,
        participant_name: linked ? submission.name || null : null,
        claimed_at: linked ? at : null,
        created_by: viewer.id,
        invited_at: at,
      })
      .select(THREAD_COLUMNS)
      .single();
    if (insErr) {
      // A teammate invited at the same moment: fall through to theirs.
      const again = await loadThreadForSubmission(supabase, type, id);
      if (!again.thread) return { status: 400, body: { error: insErr.message } };
      thread = again.thread;
    } else {
      thread = data;
    }
  } else if (!thread.participant_user_id && thread.invite_email !== email) {
    await supabase.from('submission_thread_invites').update({ revoked_at: at }).eq('thread_id', thread.id).is('revoked_at', null);
    const { data, error: upErr } = await supabase
      .from('submission_threads')
      .update({ invite_email: email, invited_at: at })
      .eq('id', thread.id)
      .select(THREAD_COLUMNS)
      .single();
    if (upErr) return { status: 400, body: { error: upErr.message } };
    thread = data;
  } else if (thread.participant_user_id && thread.invite_email !== email) {
    return { status: 409, body: { error: 'This conversation is already linked to their account.' } };
  }

  if (thread.status === 'closed') return { status: 409, body: { error: 'Reopen the conversation before inviting again.' } };

  let message = null;
  if (opening) {
    const { data, error: mErr } = await supabase
      .from('submission_thread_messages')
      .insert({ thread_id: thread.id, author_kind: 'team', author_id: viewer.id, author_name: author.name || author.email, kind: messageKind, body: opening })
      .select(MESSAGE_COLUMNS)
      .single();
    if (mErr) return { status: 400, body: { error: mErr.message } };
    message = data;
    await supabase.from('submission_threads').update({ last_team_message_at: data.created_at, team_last_read_at: data.created_at }).eq('id', thread.id);
    thread.last_team_message_at = data.created_at;
  }

  const delivery = await deliverToGuest(supabase, { thread, submission, message, viewer, author, request, deps });
  await markContacted(supabase, submission);

  const result = await teamConversationBody(supabase, { submission, thread, viewer, deps });
  if (result.status) return result;
  return { status: existing ? 200 : 201, body: { ...result.body, delivery } };
}

export async function postTeamMessage({ type, id, rawBody, kind = 'message', request = null, deps = {} }) {
  if (!CONVERSATION_TYPES.has(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorizeTeam(deps);
  if (error) return error;
  const parsed = normalizeMessageBody(rawBody);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const loaded = await loadSubmission(supabase, type, id);
  if (loaded.error) return loaded.error;
  const submission = { ...loaded.submission, type };
  const { thread, error: tErr } = await loadThreadForSubmission(supabase, type, id);
  if (tErr) return tErr;
  if (!thread) return { status: 409, body: { error: 'Invite them to the conversation first.' } };
  if (thread.status === 'closed') return { status: 409, body: { error: 'This conversation is closed. Reopen it to send a message.' } };

  const author = await teamAuthor(supabase, viewer);
  const { data, error: mErr } = await supabase
    .from('submission_thread_messages')
    .insert({
      thread_id: thread.id,
      author_kind: 'team',
      author_id: viewer.id,
      author_name: author.name || author.email,
      kind: kind === 'question' ? 'question' : 'message',
      body: parsed.body,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (mErr) return { status: 400, body: { error: mErr.message } };
  // Writing implies the team has read everything before it.
  await supabase.from('submission_threads').update({ last_team_message_at: data.created_at, team_last_read_at: data.created_at }).eq('id', thread.id);
  thread.last_team_message_at = data.created_at;

  const delivery = await deliverToGuest(supabase, { thread, submission, message: data, viewer, author, request, deps });
  await markContacted(supabase, submission);
  return { status: 201, body: { message: { ...presentMessage(data, viewer), open_question: data.kind === 'question' }, delivery } };
}

export async function deleteTeamMessage({ type, id, messageId, deps = {} }) {
  if (!CONVERSATION_TYPES.has(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorizeTeam(deps);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { thread, error: tErr } = await loadThreadForSubmission(supabase, type, id);
  if (tErr) return tErr;
  if (!thread) return { status: 404, body: { error: 'Message not found.' } };
  const { data: msg, error: mErr } = await supabase
    .from('submission_thread_messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', messageId)
    .eq('thread_id', thread.id)
    .maybeSingle();
  if (mErr) return { status: 400, body: { error: mErr.message } };
  if (!msg || msg.deleted_at) return { status: 404, body: { error: 'Message not found.' } };
  if (msg.author_kind !== 'team') return { status: 403, body: { error: 'Messages from the submitter can\u2019t be deleted.' } };
  if (msg.author_id !== viewer.id && !viewer.isOwner) {
    return { status: 403, body: { error: 'Only the author or the owner can delete this message.' } };
  }
  const { error: dErr } = await supabase
    .from('submission_thread_messages')
    .update({ deleted_at: nowIso(deps), deleted_by: viewer.id })
    .eq('id', messageId)
    .is('deleted_at', null);
  if (dErr) return { status: 400, body: { error: dErr.message } };
  return { status: 200, body: { ok: true } };
}

export async function setConversationStatus({ type, id, status, deps = {} }) {
  if (!CONVERSATION_TYPES.has(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  if (status !== 'open' && status !== 'closed') return { status: 400, body: { error: 'Invalid status.' } };
  const { viewer, error } = await authorizeTeam(deps);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { thread, error: tErr } = await loadThreadForSubmission(supabase, type, id);
  if (tErr) return tErr;
  if (!thread) return { status: 404, body: { error: 'No conversation yet.' } };
  const at = nowIso(deps);
  const patch = status === 'closed'
    ? { status, closed_at: at, closed_by: viewer.id, team_last_read_at: at }
    : { status, closed_at: null, closed_by: null };
  const { data, error: upErr } = await supabase.from('submission_threads').update(patch).eq('id', thread.id).select(THREAD_COLUMNS).single();
  if (upErr) return { status: 400, body: { error: upErr.message } };
  return { status: 200, body: { thread: presentThreadForTeam(data) } };
}

// Admin inbox: every conversation, newest activity first, with the ones
// waiting on the team flagged.
export async function listTeamConversations({ filter = 'all', deps = {} } = {}) {
  const { error } = await authorizeTeam(deps);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  let q = supabase.from('submission_threads').select(THREAD_COLUMNS);
  if (filter === 'awaiting') q = q.eq('awaiting_team', true).eq('status', 'open');
  if (filter === 'closed') q = q.eq('status', 'closed');
  if (filter === 'open') q = q.eq('status', 'open');
  const { data, error: qErr } = await q.order('invited_at', { ascending: false }).limit(300);
  if (qErr) return { status: 400, body: { error: qErr.message } };
  const rows = (data || []).map((t) => ({
    ...presentThreadForTeam(t),
    submission_type: t.submission_type,
    submission_id: t.submission_id,
    type_label: TYPE_META[t.submission_type]?.label || 'Submission',
    href: `${TYPE_META[t.submission_type]?.routeBase || '/bananas'}/${t.submission_id}`,
    last_activity_at: latest(t.last_team_message_at, t.last_guest_message_at) || t.invited_at,
    waiting_on: t.status === 'closed' ? null : t.awaiting_team ? 'team' : t.last_team_message_at ? 'guest' : null,
  }));
  rows.sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at));
  return { status: 200, body: { conversations: rows } };
}

// ---------------------------------------------------------------------------
// Submitter (guest) operations
// ---------------------------------------------------------------------------

async function guestThread(supabase, threadId, userId) {
  if (typeof threadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(threadId)) return { error: { status: 404, body: { error: 'Conversation not found.' } } };
  const { data, error } = await supabase.from('submission_threads').select(THREAD_COLUMNS).eq('id', threadId).maybeSingle();
  if (error) return { error: { status: 400, body: { error: error.message } } };
  // Same 404 for "missing" and "not yours": never confirm another person's thread exists.
  if (!data || data.participant_user_id !== userId) return { error: { status: 404, body: { error: 'Conversation not found.' } } };
  return { thread: data };
}

export async function listMyConversations({ request = null, deps = {} } = {}) {
  const { user, error } = await authorizeGuest(deps, request);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { data, error: qErr } = await supabase
    .from('submission_threads')
    .select(THREAD_COLUMNS)
    .eq('participant_user_id', user.id)
    .limit(100);
  if (qErr) return { status: 400, body: { error: qErr.message } };
  const threads = data || [];
  const items = [];
  for (const t of threads) {
    const meta = TYPE_META[t.submission_type];
    const { data: sub } = meta ? await supabase.from(meta.table).select('created_at').eq('id', t.submission_id).maybeSingle() : { data: null };
    const { data: lastRows } = await supabase
      .from('submission_thread_messages')
      .select(MESSAGE_COLUMNS)
      .eq('thread_id', t.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500);
    const msgs = lastRows || [];
    const last = msgs[msgs.length - 1] || null;
    items.push({
      ...presentThreadForGuest(t, sub),
      open_questions: openQuestionIds(msgs).length,
      preview: last ? { author_kind: last.author_kind, author_name: last.author_kind === 'team' ? TEAM_DISPLAY_NAME : 'You', body: last.body.slice(0, 160) } : null,
    });
  }
  items.sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at));
  return { status: 200, body: { conversations: items } };
}

export async function getMyConversation({ threadId, markRead = true, request = null, deps = {} }) {
  const { user, viewer, error } = await authorizeGuest(deps, request);
  if (error) return error;
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { thread, error: tErr } = await guestThread(supabase, threadId, user.id);
  if (tErr) return tErr;
  const meta = TYPE_META[thread.submission_type];
  const { data: sub } = meta ? await supabase.from(meta.table).select('created_at').eq('id', thread.submission_id).maybeSingle() : { data: null };
  const loaded = await loadMessages(supabase, thread.id);
  if (loaded.error) return loaded.error;
  if (markRead && thread.unread_by_guest) {
    await supabase.from('submission_threads').update({ guest_last_read_at: nowIso(deps) }).eq('id', thread.id);
    thread.unread_by_guest = false;
  }
  const open = new Set(openQuestionIds(loaded.messages));
  return {
    status: 200,
    body: {
      conversation: presentThreadForGuest(thread, sub),
      messages: loaded.messages.map((m) => ({ ...presentMessage(m, viewer), open_question: open.has(m.id) })),
    },
  };
}

export async function postGuestMessage({ threadId, rawBody, replyToId = null, request = null, deps = {} }) {
  const { user, viewer, error } = await authorizeGuest(deps, request);
  if (error) return error;
  const parsed = normalizeMessageBody(rawBody);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { thread, error: tErr } = await guestThread(supabase, threadId, user.id);
  if (tErr) return tErr;
  if (thread.status === 'closed') return { status: 409, body: { error: 'This conversation is closed.' } };

  let replyTo = null;
  if (replyToId) {
    const { data: q } = await supabase
      .from('submission_thread_messages')
      .select('id, kind, author_kind, deleted_at')
      .eq('id', replyToId)
      .eq('thread_id', thread.id)
      .maybeSingle();
    if (!q || q.deleted_at || q.kind !== 'question' || q.author_kind !== 'team') {
      return { status: 400, body: { error: 'That question is no longer available.' } };
    }
    replyTo = q.id;
  }

  const { data: account } = await supabase.from('free_accounts').select('full_name').eq('user_id', user.id).maybeSingle();
  const authorName = account?.full_name || thread.participant_name || user.user_metadata?.full_name || user.email;
  const { data, error: mErr } = await supabase
    .from('submission_thread_messages')
    .insert({ thread_id: thread.id, author_kind: 'guest', author_id: user.id, author_name: authorName, kind: 'message', reply_to_id: replyTo, body: parsed.body })
    .select(MESSAGE_COLUMNS)
    .single();
  if (mErr) return { status: 400, body: { error: mErr.message } };
  await supabase.from('submission_threads').update({ last_guest_message_at: data.created_at, guest_last_read_at: data.created_at }).eq('id', thread.id);

  // Tell the admins. Best effort, one feed row each.
  try {
    const meta = TYPE_META[thread.submission_type];
    const recipients = await (deps.adminAudience || defaultAdminAudience)(supabase);
    const notifyFn = deps.notify || defaultNotify;
    await Promise.all(recipients.map((userId) => notifyFn(supabase, {
      userId,
      type: 'admin_conversation_reply',
      title: replyTo ? `${firstName(authorName) || 'They'} answered your question` : `New reply from ${firstName(authorName) || 'a submitter'}`,
      body: thread.subject,
      data: { thread_id: thread.id, url: `${meta?.routeBase || '/bananas'}/${thread.submission_id}#conversation` },
    })));
  } catch (err) {
    console.error('[conversations.notifyTeam]', err?.message || err);
  }

  return { status: 201, body: { message: presentMessage(data, viewer) } };
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

// Looks up an invite by its raw token. Returns { state, thread?, invite? }:
//   'invalid' | 'expired' | 'revoked' | 'claimed_other' | 'valid' | 'mine'
export async function resolveInvite({ token, deps = {} }) {
  if (!isInviteTokenShape(token)) return { state: 'invalid' };
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { data: invite } = await supabase
    .from('submission_thread_invites')
    .select('id, thread_id, email, expires_at, revoked_at, used_at, used_by')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle();
  if (!invite) return { state: 'invalid' };
  const { data: thread } = await supabase.from('submission_threads').select(THREAD_COLUMNS).eq('id', invite.thread_id).maybeSingle();
  if (!thread) return { state: 'invalid' };
  if (invite.revoked_at) return { state: 'revoked', thread, invite };
  const now = deps.now ? deps.now() : new Date();
  if (new Date(invite.expires_at) < now && !thread.participant_user_id) return { state: 'expired', thread, invite };
  return { state: 'valid', thread, invite };
}

// Attaches the thread to the signed-in account when emails match. Idempotent:
// a second visit by the same account just returns the thread id.
export async function claimInvite({ token, user, deps = {} }) {
  const resolved = await resolveInvite({ token, deps });
  if (resolved.state !== 'valid') return { ok: false, reason: resolved.state, thread: resolved.thread || null, invite: resolved.invite || null };
  const { thread, invite } = resolved;
  if (!user?.id) return { ok: false, reason: 'signed_out', thread, invite };
  if (thread.participant_user_id) {
    return thread.participant_user_id === user.id
      ? { ok: true, threadId: thread.id }
      : { ok: false, reason: 'claimed_other', thread, invite };
  }
  if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
    return { ok: false, reason: 'email_mismatch', thread, invite };
  }
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const at = nowIso(deps);
  const { data: account } = await supabase.from('free_accounts').select('full_name').eq('user_id', user.id).maybeSingle();
  const { data: updated, error } = await supabase
    .from('submission_threads')
    .update({ participant_user_id: user.id, participant_name: account?.full_name || user.user_metadata?.full_name || null, claimed_at: at })
    .eq('id', thread.id)
    .is('participant_user_id', null)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, reason: 'error', thread, invite };
  if (!updated) {
    // Lost a race; re-read to see who won.
    const { data: again } = await supabase.from('submission_threads').select('participant_user_id').eq('id', thread.id).maybeSingle();
    return again?.participant_user_id === user.id ? { ok: true, threadId: thread.id } : { ok: false, reason: 'claimed_other', thread, invite };
  }
  await supabase.from('submission_thread_invites').update({ used_at: at, used_by: user.id }).eq('id', invite.id);
  return { ok: true, threadId: thread.id };
}

// Small helper for the account profile: does this account have any
// conversations, and how many have unread team messages?
export async function conversationSummaryForUser(supabase, userId) {
  if (!userId) return { count: 0, unread: 0 };
  const { data, error } = await supabase
    .from('submission_threads')
    .select('id, unread_by_guest')
    .eq('participant_user_id', userId)
    .limit(100);
  if (error) return { count: 0, unread: 0 };
  const rows = data || [];
  return { count: rows.length, unread: rows.filter((r) => r.unread_by_guest).length };
}
