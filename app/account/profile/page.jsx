// app/account/profile/page.jsx
//
// Profile tab of the Stardust-account hub. Intentionally minimal for this
// PR \u2014 the shipping surface is the Tickets tab. This page exists so the
// tabs render as a working three-tab bar rather than a link that 404s.
// Follow-up PR will wire this up to the free_accounts + member_profiles
// tables so members can edit their name, phone, and email preferences.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AccountProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let freeAccount = null;
  if (isSupabaseConfigured()) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('free_accounts')
      .select('full_name, email, phone, phone_verified_at')
      .eq('user_id', user.id)
      .maybeSingle();
    freeAccount = data;
  }

  const rows = [
    { label: 'NAME', value: freeAccount?.full_name || user.user_metadata?.full_name || '\u2014' },
    { label: 'EMAIL', value: user.email || freeAccount?.email || '\u2014' },
    { label: 'PHONE', value: freeAccount?.phone || '\u2014' },
  ];

  return (
    <div
      style={{
        background: '#111',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 13, color: '#a0a0a0', marginBottom: 16 }}>
        Your account profile. Editing lands in a follow-up.
      </div>
      <dl style={{ margin: 0 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <dt style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#8a8a8a' }}>
              {r.label}
            </dt>
            <dd style={{ margin: 0, fontSize: 14, color: '#f5f5f5' }}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
