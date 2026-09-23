// Run ONLY after a verified schema-only baseline on the approved preview branch.
// Does not copy production data, send invites, or mark fixtures ready to launch.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { VIEW_PERSONAS, personaEmail } from '../lib/view-portal/personas.js';
import { PREVIEW_PROJECT_REF } from '../lib/view-portal/config.js';

if (process.env.VIEW_PORTAL_MODE !== 'sandbox'
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PREVIEW_PROJECT_REF}.supabase.co`
  || process.env.VIEW_PORTAL_SCHEMA_VERIFIED !== 'true') {
  throw new Error('Refusing fixture seeding outside the verified isolated database.');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Sandbox service credential is required.');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const now = new Date();
const future = new Date(now.getTime() + 30 * 86400000).toISOString();
const past = new Date(now.getTime() - 86400000).toISOString();
const users = [];
for (let page = 1; ; page += 1) {
  const result = await db.auth.admin.listUsers({ page, perPage: 100 });
  check(result); users.push(...result.data.users);
  if (result.data.users.length < 100) break;
}
for (const [index, persona] of VIEW_PERSONAS.entries()) {
  const email = personaEmail(persona.id);
  // IDs contain letters/hyphens only; labels can contain "/" or "+", which
  // deliberately fail the application's legal-name intake validation.
  const fullName = `Preview ${persona.id}`;
  let user = users.find((entry) => entry.email === email);
  if (!user) {
    user = check(await db.auth.admin.createUser({
      email, email_confirm: true,
      app_metadata: { view_portal_persona: persona.id },
      user_metadata: { full_name: fullName },
    })).user;
  } else if (user.app_metadata?.view_portal_persona !== persona.id) {
    throw new Error('Existing identity is not a registered preview persona.');
  }
  const phone = `+120255501${String(index).padStart(2, '0')}`;
  check(await db.from('view_portal_personas').upsert({
    persona_id: persona.id, user_id: user.id, ready: false, fixture_version: 1,
  }, { onConflict: 'persona_id' }));
  check(await db.from('free_accounts').upsert({
    user_id: user.id, full_name: fullName, email, phone, phone_verified_at: now.toISOString(),
  }, { onConflict: 'user_id' }));
  if (persona.plan) {
    check(await db.from('member_profiles').upsert({
      user_id: user.id, email, full_name: fullName, is_active: true,
      subscription_plan: persona.plan, subscription_status: 'active',
      current_period_end: future, subscription_period: 'monthly',
    }, { onConflict: 'user_id' }));
  }
  if (persona.teamRole) {
    check(await db.from('team_members').upsert({
      user_id: user.id, email, full_name: fullName, role: persona.teamRole,
    }, { onConflict: 'email' }));
  }
  if (persona.trial) {
    const old = check(await db.from('trial_passes').select('id').eq('user_id', user.id).maybeSingle());
    const trial = {
      user_id: user.id, full_name: fullName, email, phone, phone_verified_at: now.toISOString(),
      activated_at: past, status: persona.trial === 'active' ? 'active' : 'expired',
      expires_at: persona.trial === 'active' ? future : past,
      qr_token_hash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    };
    check(old ? await db.from('trial_passes').update(trial).eq('id', old.id) : await db.from('trial_passes').insert(trial));
  }
  if (persona.partner) {
    const existing = check(await db.from('partner_profiles').select('contact_id').eq('user_id', user.id).maybeSingle());
    const contactId = existing?.contact_id || check(await db.from('contacts').insert({
      display_name: fullName, email, contact_type: persona.partner,
    }).select('id').single()).id;
    check(await db.from('partner_profiles').upsert({
      user_id: user.id, contact_id: contactId, full_name: fullName, invited_email: email,
      is_active: !persona.partnerState, activated_at: persona.partnerState === 'invited' ? null : past,
    }, { onConflict: 'user_id' }));
  }
  console.log(`Prepared ${persona.id}; launch remains locked pending fixture acceptance.`);
}
