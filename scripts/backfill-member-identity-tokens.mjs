#!/usr/bin/env node
// One-time backfill: issue an identity token to every existing member that
// doesn't already have one.
//
// Idempotent: a row already in member_identity_tokens is left alone, and the
// insert uses the member_profile_id unique constraint to prevent doubles even
// if two copies of this script race.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backfill-member-identity-tokens.mjs
//
// The RAW tokens are printed to stdout so the operator can hand them to the
// members (email, DM, whatever) if needed. Nothing is persisted anywhere
// else: the DB only has the hash.

import { createClient } from '@supabase/supabase-js';
import {
  generateMemberIdentityToken,
  hashMemberIdentityToken,
} from '../lib/member-identity.js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: members, error } = await admin
  .from('member_profiles')
  .select('id, full_name, email')
  .order('created_at', { ascending: true });

if (error) {
  console.error('Failed to list members:', error.message);
  process.exit(1);
}

const { data: existing } = await admin
  .from('member_identity_tokens')
  .select('member_profile_id');
const already = new Set((existing || []).map((r) => r.member_profile_id));

let issued = 0;
let skipped = 0;

for (const member of members || []) {
  if (already.has(member.id)) {
    skipped += 1;
    continue;
  }

  const raw = generateMemberIdentityToken();
  const hash = hashMemberIdentityToken(raw);

  const { error: insertErr } = await admin
    .from('member_identity_tokens')
    .insert({ member_profile_id: member.id, token_hash: hash });

  if (insertErr) {
    console.error(`Failed for ${member.email}: ${insertErr.message}`);
    continue;
  }

  issued += 1;
  console.log(`ISSUED  ${member.email.padEnd(40)}  raw=${raw}`);
}

console.log('');
console.log(`Done. Issued ${issued}, skipped ${skipped} already-tokenized members.`);
