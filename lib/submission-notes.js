// Internal team notes on incoming submissions. Server-only helpers shared by
// the notes API routes and the detail pages' initial server render.
//
// Rules (all enforced here, never in the browser):
//   - Only admins (requireAdminMfa) can read or write notes.
//   - Author identity comes from the signed-in user's team_members row.
//   - Only the author can edit a note. The author or the owner can delete it.
//   - Deletes are soft so the trail stays auditable.

export const NOTE_SUBMISSION_TYPES = new Set([
  'applications',
  'collaborations',
  'micro-parties',
  'venue-inquiries',
]);

export const NOTE_MAX_LENGTH = 5000;

const NOTE_COLUMNS = 'id, author_id, author_name, author_email, body, created_at, edited_at';

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

export function normalizeNoteBody(raw) {
  if (typeof raw !== 'string') return { error: 'Note text is required.' };
  const body = raw.replace(/\r\n/g, '\n').trim();
  if (!body) return { error: 'Note can\u2019t be empty.' };
  if (body.length > NOTE_MAX_LENGTH) {
    return { error: `Notes are limited to ${NOTE_MAX_LENGTH} characters.` };
  }
  return { body };
}

// Shape returned to the browser. `can_edit` / `can_delete` are computed for
// the current viewer so the UI only shows controls the server will honor.
export function presentNote(row, viewer) {
  const isAuthor = Boolean(viewer?.id && row.author_id && viewer.id === row.author_id);
  return {
    id: row.id,
    author_name: row.author_name || row.author_email || 'Team member',
    author_email: row.author_email,
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at,
    is_mine: isAuthor,
    can_edit: isAuthor,
    can_delete: isAuthor || Boolean(viewer?.isOwner),
  };
}

async function authorize(deps) {
  const auth = deps.requireAdminMfa || defaultRequireAdminMfa;
  const result = await auth();
  if (result.unauthorized || !result.user) {
    return { error: { status: 401, body: { error: 'Unauthorized', reason: result.reason || null } } };
  }
  const ownerEmail = deps.ownerEmail || (await defaultOwnerEmail());
  const email = (result.user.email || '').toLowerCase();
  return {
    viewer: { id: result.user.id, email: result.user.email, isOwner: email === ownerEmail.toLowerCase() },
  };
}

async function submissionExists(supabase, type, id) {
  const { resolveSubmissionTypeConfig } = await import('./submission-workflow.js');
  const config = resolveSubmissionTypeConfig(type);
  if (!config) return { ok: false, status: 404, error: 'Unknown submission type.' };
  const { data, error } = await supabase.from(config.table).select('id').eq('id', id).maybeSingle();
  if (error) return { ok: false, status: 400, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'Submission not found.' };
  return { ok: true };
}

function validType(type) {
  return NOTE_SUBMISSION_TYPES.has(type);
}

export async function listSubmissionNotes({ type, id, deps = {} }) {
  if (!validType(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorize(deps);
  if (error) return error;

  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const { data, error: qErr } = await supabase
    .from('submission_notes')
    .select(NOTE_COLUMNS)
    .eq('submission_type', type)
    .eq('submission_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (qErr) return { status: 400, body: { error: qErr.message } };
  return { status: 200, body: { notes: (data || []).map((r) => presentNote(r, viewer)) } };
}

export async function createSubmissionNote({ type, id, rawBody, deps = {} }) {
  if (!validType(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorize(deps);
  if (error) return error;

  const parsed = normalizeNoteBody(rawBody);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };

  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const exists = await (deps.submissionExists || submissionExists)(supabase, type, id);
  if (!exists.ok) return { status: exists.status, body: { error: exists.error } };

  const { data: tm } = await supabase
    .from('team_members')
    .select('email, full_name')
    .eq('user_id', viewer.id)
    .maybeSingle();

  const { data, error: insErr } = await supabase
    .from('submission_notes')
    .insert({
      submission_type: type,
      submission_id: id,
      author_id: viewer.id,
      author_name: tm?.full_name || null,
      author_email: tm?.email || viewer.email,
      body: parsed.body,
    })
    .select(NOTE_COLUMNS)
    .single();
  if (insErr) return { status: 400, body: { error: insErr.message } };
  return { status: 201, body: { note: presentNote(data, viewer) } };
}

async function loadOwnedNote(supabase, { type, id, noteId }) {
  const { data, error } = await supabase
    .from('submission_notes')
    .select(`${NOTE_COLUMNS}, deleted_at`)
    .eq('id', noteId)
    .eq('submission_type', type)
    .eq('submission_id', id)
    .maybeSingle();
  if (error) return { error: { status: 400, body: { error: error.message } } };
  if (!data || data.deleted_at) return { error: { status: 404, body: { error: 'Note not found.' } } };
  return { note: data };
}

export async function updateSubmissionNote({ type, id, noteId, rawBody, deps = {} }) {
  if (!validType(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorize(deps);
  if (error) return error;

  const parsed = normalizeNoteBody(rawBody);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };

  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const loaded = await loadOwnedNote(supabase, { type, id, noteId });
  if (loaded.error) return loaded.error;
  if (loaded.note.author_id !== viewer.id) {
    return { status: 403, body: { error: 'Only the author can edit this note.' } };
  }
  if (loaded.note.body === parsed.body) {
    return { status: 200, body: { note: presentNote(loaded.note, viewer) } };
  }

  const { data, error: upErr } = await supabase
    .from('submission_notes')
    .update({ body: parsed.body, edited_at: new Date().toISOString() })
    .eq('id', noteId)
    .eq('author_id', viewer.id)
    .is('deleted_at', null)
    .select(NOTE_COLUMNS)
    .single();
  if (upErr) return { status: 400, body: { error: upErr.message } };
  return { status: 200, body: { note: presentNote(data, viewer) } };
}

export async function deleteSubmissionNote({ type, id, noteId, deps = {} }) {
  if (!validType(type)) return { status: 404, body: { error: 'Unknown submission type.' } };
  const { viewer, error } = await authorize(deps);
  if (error) return error;

  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const loaded = await loadOwnedNote(supabase, { type, id, noteId });
  if (loaded.error) return loaded.error;
  if (loaded.note.author_id !== viewer.id && !viewer.isOwner) {
    return { status: 403, body: { error: 'Only the author or the owner can delete this note.' } };
  }

  const { error: delErr } = await supabase
    .from('submission_notes')
    .update({ deleted_at: new Date().toISOString(), deleted_by: viewer.id })
    .eq('id', noteId)
    .is('deleted_at', null);
  if (delErr) return { status: 400, body: { error: delErr.message } };
  return { status: 200, body: { ok: true } };
}
