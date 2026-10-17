// Staff notes and tags on a Person Profile. Server-only, shared by the
// /api/admin/people/[ref]/notes|tags routes and the profile page's first
// render.
//
// Rules (enforced here, never in the browser):
//   - Only admins (requireAdminMfa) can read or write.
//   - Notes and tags are stored against every identity key the person has
//     when written, and read back by key overlap, so a note written on a
//     Trial Pass profile still shows after that person becomes a member.
//   - Only the author can edit a note; the author or the owner can delete.
//   - Any admin can add or remove a tag. Deletes and removals are soft.

import { normalizeNoteBody, NOTE_MAX_LENGTH } from './submission-notes.js';

export { NOTE_MAX_LENGTH };
export const TAG_MAX_LENGTH = 32;
export const MAX_TAGS = 20;

const NOTE_COLUMNS = 'id, author_id, author_name, author_email, body, created_at, edited_at';
const TAG_COLUMNS = 'id, label, created_by, created_by_name, created_at';

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
async function defaultResolveIdentity(admin, ref) {
  const mod = await import('./person-profile/identity.js');
  return mod.resolvePersonIdentity(admin, ref);
}

export function normalizeTagLabel(raw) {
  if (typeof raw !== 'string') return { error: 'Tag text is required.' };
  const label = raw.replace(/\s+/g, ' ').trim();
  if (!label) return { error: 'Tag can\u2019t be empty.' };
  if (label.length > TAG_MAX_LENGTH) return { error: `Tags are limited to ${TAG_MAX_LENGTH} characters.` };
  return { label };
}

export function presentNote(row, viewer) {
  const isAuthor = Boolean(viewer?.id && row.author_id && viewer.id === row.author_id);
  return {
    id: row.id,
    author_name: row.author_name || row.author_email || 'Team member',
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at,
    can_edit: isAuthor,
    can_delete: isAuthor || Boolean(viewer?.isOwner),
  };
}

export function presentTag(row) {
  return { id: row.id, label: row.label, created_by_name: row.created_by_name || null, created_at: row.created_at };
}

async function authorize(deps) {
  const result = await (deps.requireAdminMfa || defaultRequireAdminMfa)();
  if (result.unauthorized || !result.user) {
    return { error: { status: 401, body: { error: 'Unauthorized', reason: result.reason || null } } };
  }
  const ownerEmail = deps.ownerEmail || (await defaultOwnerEmail());
  const email = (result.user.email || '').toLowerCase();
  return { viewer: { id: result.user.id, email: result.user.email, isOwner: email === ownerEmail.toLowerCase() } };
}

async function context(ref, deps) {
  const { viewer, error } = await authorize(deps);
  if (error) return { error };
  const supabase = await (deps.createAdminClient || defaultCreateAdminClient)();
  const identity = await (deps.resolveIdentity || defaultResolveIdentity)(supabase, ref);
  if (!identity || !identity.anchorKey) return { error: { status: 404, body: { error: 'Person not found.' } } };
  return { viewer, supabase, identity };
}

async function authorName(supabase, viewer) {
  const { data } = await supabase.from('team_members').select('email, full_name').eq('user_id', viewer.id).maybeSingle();
  return { name: data?.full_name || null, email: data?.email || viewer.email };
}

// Read helpers used by both the API and the page (page has already gated).
export async function readPersonNotes(supabase, identityKeys, viewer) {
  if (!identityKeys.length) return [];
  const { data, error } = await supabase
    .from('person_notes').select(NOTE_COLUMNS)
    .overlaps('identity_keys', identityKeys).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => presentNote(r, viewer));
}

export async function readPersonTags(supabase, identityKeys) {
  if (!identityKeys.length) return [];
  const { data, error } = await supabase
    .from('person_tags').select(TAG_COLUMNS)
    .overlaps('identity_keys', identityKeys).is('removed_at', null)
    .order('created_at', { ascending: true }).limit(100);
  if (error) throw new Error(error.message);
  // Two linked records can each carry the same tag; show it once.
  const seen = new Set();
  return (data || []).filter((t) => {
    const k = t.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map(presentTag);
}

export async function listPersonNotes({ ref, deps = {} }) {
  const ctx = await context(ref, deps);
  if (ctx.error) return ctx.error;
  try {
    const notes = await readPersonNotes(ctx.supabase, ctx.identity.identityKeys, ctx.viewer);
    return { status: 200, body: { notes } };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
}

export async function createPersonNote({ ref, rawBody, deps = {} }) {
  const parsed = normalizeNoteBody(rawBody);
  const ctx = await context(ref, deps);
  if (ctx.error) return ctx.error;
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const author = await authorName(ctx.supabase, ctx.viewer);
  const { data, error } = await ctx.supabase.from('person_notes').insert({
    anchor_key: ctx.identity.anchorKey,
    identity_keys: ctx.identity.identityKeys,
    author_id: ctx.viewer.id,
    author_name: author.name,
    author_email: author.email,
    body: parsed.body,
  }).select(NOTE_COLUMNS).single();
  if (error) return { status: 400, body: { error: error.message } };
  return { status: 201, body: { note: presentNote(data, ctx.viewer) } };
}

async function loadNote(ctx, noteId) {
  const { data, error } = await ctx.supabase
    .from('person_notes').select(`${NOTE_COLUMNS}, identity_keys, deleted_at`)
    .eq('id', noteId).maybeSingle();
  if (error) return { error: { status: 400, body: { error: error.message } } };
  const belongs = data && !data.deleted_at && (data.identity_keys || []).some((k) => ctx.identity.identityKeys.includes(k));
  if (!belongs) return { error: { status: 404, body: { error: 'Note not found.' } } };
  return { note: data };
}

export async function updatePersonNote({ ref, noteId, rawBody, deps = {} }) {
  const ctx = await context(ref, deps);
  if (ctx.error) return ctx.error;
  const parsed = normalizeNoteBody(rawBody);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const loaded = await loadNote(ctx, noteId);
  if (loaded.error) return loaded.error;
  if (loaded.note.author_id !== ctx.viewer.id) return { status: 403, body: { error: 'Only the author can edit this note.' } };
  if (loaded.note.body === parsed.body) return { status: 200, body: { note: presentNote(loaded.note, ctx.viewer) } };
  const { data, error } = await ctx.supabase.from('person_notes')
    .update({ body: parsed.body, edited_at: new Date().toISOString() })
    .eq('id', noteId).eq('author_id', ctx.viewer.id).is('deleted_at', null)
    .select(NOTE_COLUMNS).single();
  if (error) return { status: 400, body: { error: error.message } };
  return { status: 200, body: { note: presentNote(data, ctx.viewer) } };
}

export async function deletePersonNote({ ref, noteId, deps = {} }) {
  const ctx = await context(ref, deps);
  if (ctx.error) return ctx.error;
  const loaded = await loadNote(ctx, noteId);
  if (loaded.error) return loaded.error;
  if (loaded.note.author_id !== ctx.viewer.id && !ctx.viewer.isOwner) {
    return { status: 403, body: { error: 'Only the author or the owner can delete this note.' } };
  }
  const { error } = await ctx.supabase.from('person_notes')
    .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.viewer.id })
    .eq('id', noteId).is('deleted_at', null);
  if (error) return { status: 400, body: { error: error.message } };
  return { status: 200, body: { ok: true } };
}

export async function addPersonTag({ ref, rawLabel, deps = {} }) {
  const parsed = normalizeTagLabel(rawLabel);
  const ctx = await context(ref, deps);
  if (ctx.error) return ctx.error;
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  let existing;
  try { existing = await readPersonTags(ctx.supabase, ctx.identity.identityKeys); } catch (e) { return { status: 400, body: { error: e.message } }; }
  const dup = existing.find((t) => t.label.toLowerCase() === parsed.label.toLowerCase());
  if (dup) return { status: 200, body: { tag: dup } };
  if (existing.length >= MAX_TAGS) return { status: 400, body: { error: `A profile can have up to ${MAX_TAGS} tags.` } };
  const author = await authorName(ctx.supabase, ctx.viewer);
  const { data, error } = await ctx.supabase.from('person_tags').insert({
    anchor_key: ctx.identity.anchorKey,
    identity_keys: ctx.identity.identityKeys,
    label: parsed.label,
    created_by: ctx.viewer.id,
    created_by_name: author.name || author.email,
  }).select(TAG_COLUMNS).single();
  if (error) return { status: 400, body: { error: error.message } };
  return { status: 201, body: { tag: presentTag(data) } };
}

// Removing a tag removes every active copy of that label across the
// person's linked records, so it doesn't reappear from another record.
export async function removePersonTag({ ref, tagId, deps = {} }) {
  const ctx = await context(ref, deps);
  if (ctx.error) return ctx.error;
  const { data: tag, error } = await ctx.supabase
    .from('person_tags').select('id, label, identity_keys, removed_at').eq('id', tagId).maybeSingle();
  if (error) return { status: 400, body: { error: error.message } };
  const belongs = tag && !tag.removed_at && (tag.identity_keys || []).some((k) => ctx.identity.identityKeys.includes(k));
  if (!belongs) return { status: 404, body: { error: 'Tag not found.' } };
  const { error: upErr } = await ctx.supabase.from('person_tags')
    .update({ removed_at: new Date().toISOString(), removed_by: ctx.viewer.id })
    .overlaps('identity_keys', ctx.identity.identityKeys)
    .ilike('label', tag.label.replace(/[\\%_]/g, (c) => `\\${c}`))
    .is('removed_at', null);
  if (upErr) return { status: 400, body: { error: upErr.message } };
  return { status: 200, body: { ok: true } };
}
