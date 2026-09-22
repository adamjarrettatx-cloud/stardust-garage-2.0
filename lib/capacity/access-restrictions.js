import { NextResponse } from 'next/server';
import { SUBJECT_KINDS, UUID, contactKeys, isActiveRestriction, matchLevel } from './access-policy';

async function one(admin, table, columns, id) {
  const { data, error } = await admin.from(table).select(columns).eq('id', id).single();
  if (error || !data) throw new Error('Could not resolve guest identity.');
  return data;
}
// Identity is always loaded server-side, never accepted from client claims.
// Matching email/phone/name is advisory until staff verifies the actual person.
export async function resolveAccessSubject(admin, subject) {
  if (!subject || !SUBJECT_KINDS[subject.kind] || !UUID.test(subject.id || '')) {
    throw new Error('A valid guest reference is required.');
  }
  const identity = { subject, subject_key: `${subject.kind}:${subject.id}`, identity_keys: [], match_keys: [], full_name: '' };
  const seen = new Set();
  async function visit(kind, id) {
    if (!id || seen.has(`${kind}:${id}`)) return;
    seen.add(`${kind}:${id}`);
    identity.identity_keys.push(`${kind}:${id}`);
    let row;
    if (kind === 'trial_pass') {
      row = await one(admin, 'trial_passes', 'id,full_name,email,phone,user_id,member_profile_id,guest_profile_id', id);
      await visit('member', row.member_profile_id);
      await visit('guest', row.guest_profile_id);
    } else if (kind === 'member') {
      row = await one(admin, 'member_profiles', 'id,full_name,email,user_id', id);
    } else if (kind === 'guest') {
      row = await one(admin, 'guest_profiles', 'id,full_name,email,phone', id);
    } else if (kind === 'guestlist') {
      row = await one(admin, 'event_guestlist_entries', 'id,guest_name,guest_profile_id', id);
      row.full_name = row.guest_name;
      await visit('guest', row.guest_profile_id);
    } else if (kind === 'ticket') {
      const ticket = await one(admin, 'tickets', 'id,order_id', id);
      row = await one(admin, 'orders', 'id,buyer_name,buyer_email,user_id,member_profile_id', ticket.order_id);
      row.full_name = row.buyer_name;
      row.email = row.buyer_email;
      await visit('member', row.member_profile_id);
    }
    if (row.user_id) {
      identity.identity_keys.push(`user:${row.user_id}`);
      // Registered buyers may have their current name only in free_accounts.
      const { data, error } = await admin.from('free_accounts').select('full_name,email').eq('user_id', row.user_id).maybeSingle();
      if (error) throw new Error('Could not resolve account identity.');
      if (data) identity.match_keys.push(...contactKeys(data));
    }
    identity.full_name = row.full_name || identity.full_name;
    identity.match_keys.push(...contactKeys(row));
  }
  await visit(subject.kind, subject.id);
  identity.identity_keys = [...new Set(identity.identity_keys)];
  identity.match_keys = [...new Set(identity.match_keys)];
  return identity;
}

export async function resolveAccessIdentity(admin, subject, extra = null) {
  const identity = await resolveAccessSubject(admin, subject);
  if (extra?.guestProfileId) {
    const guest = await resolveAccessSubject(admin, { kind: 'guest', id: extra.guestProfileId });
    identity.identity_keys.push(...guest.identity_keys);
    identity.match_keys.push(...guest.match_keys);
  }
  if (extra?.newGuest) identity.match_keys.push(...contactKeys(extra.newGuest));
  return identity;
}

export async function accessStatus(admin, subject, extra = null) {
  const identity = await resolveAccessIdentity(admin, subject, extra);
  const results = await Promise.all([
    admin.from('access_restrictions').select('*').overlaps('identity_keys', identity.identity_keys),
    identity.match_keys.length
      ? admin.from('access_restrictions').select('*').overlaps('match_keys', identity.match_keys)
      : Promise.resolve({ data: [] }),
    admin.from('access_restriction_exclusions').select('restriction_id').eq('subject_key', identity.subject_key),
  ]);
  if (results.some(r => r.error) || results.some(r => r.data.length >= 1000)) throw new Error('Restriction lookup unavailable.');
  const excluded = new Set(results[2].data.map(r => r.restriction_id));
  const candidates = [...new Map([...results[0].data, ...results[1].data].map(r => [r.id, r])).values()];
  const related = candidates.map(r => ({ ...r, match: matchLevel(r, identity) }))
    .filter(r => r.match === 'confirmed' || !excluded.has(r.id));
  const matches = related.filter(r => isActiveRestriction(r));
  const history = related.filter(r => !isActiveRestriction(r));
  if (related.length) {
    const { data: events, error } = await admin.from('access_restriction_events').select('*')
      .in('restriction_id', related.map(r => r.id)).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('Restriction notes unavailable.');
    for (const row of related) row.events = events.filter(e => e.restriction_id === row.id);
  }
  return { subject, full_name: identity.full_name, status: matches.some(r => r.match === 'confirmed') ? 'blocked' : matches.length ? 'verify' : 'clear', matches, history };
}

// Every admission route calls this again on commit. Scanner override flags do
// not bypass it. Missing schema/DB errors fail closed, never silently clear.
export async function restrictionGuard(admin, subject, extra = null) {
  try {
    const access = await accessStatus(admin, subject, extra);
    if (access.status === 'clear') return null;
    const reason = access.matches.map(r => `${r.full_name}: ${r.reason}`).join(' | ');
    return NextResponse.json({
      error: `${access.status === 'blocked' ? 'DO NOT ADMIT' : 'VERIFY IDENTITY before admission'}. ${reason}`,
      code: 'access_restricted', access,
    }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Access check unavailable. Hold entry and retry; do not admit.', code: 'access_unavailable' }, { status: 503 });
  }
}
