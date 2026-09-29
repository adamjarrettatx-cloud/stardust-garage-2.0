import { NextResponse } from 'next/server';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { sniffScan } from '@/lib/scan/sniff';
import { isWellFormedPassTokenShape, isWellFormedMemberIdentityTokenShape } from '@/lib/scan/token-shapes';
import { hashMemberIdentityToken } from '@/lib/member-identity';
import { hashPassToken } from '@/lib/trial-pass';
import { accessStatus, resolveAccessIdentity } from '@/lib/capacity/access-restrictions';
import { loadSecurityProfile } from '@/lib/capacity/security-profile';
import { validateIncident } from '@/lib/capacity/security-policy';
import { UUID } from '@/lib/capacity/access-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const validSubject = subject => subject && ['member', 'trial_pass', 'guest'].includes(subject.kind)
  && typeof subject.id === 'string' && UUID.test(subject.id);

// Resolves credentials only. Never call an admission/verification endpoint here:
// security scans must not activate passes, consume tickets or increment capacity.
async function scanSubject(admin, raw) {
  let scan = sniffScan(raw);
  // The shared ticket normalizer treats many bare alphabetic tokens as ticket
  // codes. Preserve real account-token shapes here, without accepting a ticket
  // as a buyer identity. URL credentials remain path-disambiguated.
  const bare = raw.trim();
  const canonicalTicket = /^[A-Z]+-(?:[A-Z0-9]{4}-){5}[A-Z0-9]{4}$/i.test(bare);
  if (!/^https?:\/\//i.test(bare) && !canonicalTicket) {
    if (isWellFormedPassTokenShape(bare)) scan = { kind: 'ambiguous_token', token: bare };
    else if (isWellFormedMemberIdentityTokenShape(bare)) scan = { kind: 'member_id', token: bare };
  }
  if (!['member_id', 'trial_pass', 'ambiguous_token'].includes(scan.kind)) {
    return { error: 'Scan the account QR or Trial Pass, not an event ticket. You can also use guest search.', status: 400 };
  }
  if (scan.kind !== 'trial_pass') {
    const { data, error } = await admin.from('member_identity_tokens')
      .select('member_profile_id,revoked_at').eq('token_hash', hashMemberIdentityToken(scan.token)).maybeSingle();
    if (error) throw error;
    if (data?.revoked_at) return { error: 'This account QR was revoked. Ask for the current QR or verify identity using guest search.', status: 410 };
    if (data) return { subject: { kind: 'member', id: data.member_profile_id } };
    if (scan.kind === 'member_id') return { error: 'Account QR not found.', status: 404 };
  }
  const { data, error } = await admin.from('trial_passes').select('id')
    .eq('qr_token_hash', hashPassToken(scan.token)).maybeSingle();
  if (error) throw error;
  return data ? { subject: { kind: 'trial_pass', id: data.id } } : { error: 'Trial Pass not found. Use the current QR or guest search.', status: 404 };
}

export async function POST(request) {
  const gate = await requireFrontDeskOrTeam(request);
  if (gate.unauthorized || !gate.user?.id) return reply({ error: 'Unauthorized' }, 401);
  const limit = rateLimit({ key: `security:${gate.user.id}`, limit: 120, windowMs: 60_000 });
  if (!limit.ok) return reply({ error: 'Too many requests. Wait a moment and retry.' }, 429);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return reply({ error: 'Request too large.' }, 413);
    body = JSON.parse(raw);
  } catch { return reply({ error: 'Invalid JSON.' }, 400); }
  if (!['lookup', 'record'].includes(body?.action)) return reply({ error: 'Invalid action.' }, 400);
  if (body.action === 'record') {
    try { validateIncident({ ...body, action: body.incident_action }); }
    catch (error) { return reply({ error: error.message }, 400); }
  }
  try {
    const admin = createAdminClient();
    let subject = body.subject;
    if (body.action === 'lookup' && body.raw != null) {
      if (typeof body.raw !== 'string' || body.raw.length > 2048) return reply({ error: 'Invalid QR.' }, 400);
      const resolved = await scanSubject(admin, body.raw);
      if (resolved.error) return reply({ error: resolved.error }, resolved.status);
      subject = resolved.subject;
    }
    if (!validSubject(subject)) return reply({ error: 'Select a verified guest account.' }, 400);
    if (body.action === 'lookup') {
      const identity = await resolveAccessIdentity(admin, subject);
      const profile = await loadSecurityProfile(admin, subject, identity.identity_keys);
      const access = await accessStatus(admin, subject);
      return reply({
        subject, profile,
        access: { status: access.status, matches: access.matches.map(row => ({
          id: row.id, kind: row.kind, reason: row.reason, match: row.match,
        })), incidents: access.incidents },
      });
    }
    const identity = await resolveAccessIdentity(admin, subject);
    // Neither actor, identity keys, name, event nor timestamp comes from the UI.
    const { data, error } = await admin.rpc('record_security_incident', {
      p_actor: gate.user.id,
      p_data: {
        request_id: body.request_id, subject_key: identity.subject_key, identity_keys: identity.identity_keys,
        match_keys: identity.match_keys, full_name: identity.full_name,
        category: body.category, action: body.incident_action, note: body.note.trim(),
        identity_confirmed: body.identity_confirmed, restriction_confirmed: body.restriction_confirmed === true,
      },
    });
    if (error) return reply({ error: error.code === '42501' ? 'Your staff access is no longer authorized.' : 'Could not save the incident. Retry without changing the form.' }, error.code === '42501' ? 403 : 409);
    return reply({ ok: true, id: data });
  } catch {
    return reply({ error: 'Security records are unavailable. Nothing is confirmed saved; retry or contact a manager.' }, 503);
  }
}
