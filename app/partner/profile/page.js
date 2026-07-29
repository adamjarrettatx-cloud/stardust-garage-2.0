import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { contactTypeLabel } from '@/lib/contact-helpers';
import PartnerSignOutButton from '../PartnerSignOutButton';

export const revalidate = 0;

// The partner's own record, read-only. Everything shown here comes from
// public.partner_self(), which returns the partner_profiles row plus only the
// display name and relationship type from the linked contact — internal_notes and
// the rest of the CRM record stay on the staff side.
//
// Partners are not members and not team, so this uses the hardcoded /member dark
// palette rather than the --auth-* variables (those are only injected for the
// /bananas and /team scopes — see lib/authenticated-theme.js).
export default async function PartnerProfilePage() {
  // middleware.js already bounces anyone without an active partner profile off
  // /partner/*; this is the server-side gate that makes the page safe on its own.
  const { user, partner, unauthorized } = await requirePartner();
  if (unauthorized) redirect('/');

  const types = Array.isArray(partner.contact_type) ? partner.contact_type : [];

  return (
    <main className="max-w-[720px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between gap-6 mb-12">
        <div>
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-3"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            PARTNER AREA
          </div>
          <h1
            className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {partner.full_name || partner.contact_display_name}
          </h1>
        </div>
        <PartnerSignOutButton />
      </div>

      <div
        className="rounded-[14px] border p-7 flex items-center gap-6"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        {partner.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={partner.photo_url}
            alt={partner.full_name || 'Partner photo'}
            className="w-[96px] h-[96px] flex-shrink-0 object-cover"
            style={{ borderRadius: '16px', border: '1px solid #2a2a2a' }}
          />
        ) : (
          <div
            className="w-[96px] h-[96px] flex-shrink-0 flex items-center justify-center text-[11px] font-semibold tracking-[0.12em]"
            style={{ borderRadius: '16px', border: '1px solid #2a2a2a', color: '#555' }}
          >
            NO PHOTO
          </div>
        )}

        <div className="min-w-0">
          <div className="text-[20px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {partner.contact_display_name}
          </div>
          {types.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <span
                  key={t}
                  className="px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-[0.12em]"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#a0a0a0' }}
                >
                  {contactTypeLabel(t).toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-8 text-[13px] leading-[1.6]" style={{ color: '#8a8a8a' }}>
        Signed in as <span style={{ color: '#f5f5f5' }}>{user.email}</span>. To change your name,
        photo or the details we have on file, email{' '}
        <a href="mailto:info@sdgatx.com" style={{ color: '#f5f5f5' }}>
          info@sdgatx.com
        </a>
        .
      </p>
    </main>
  );
}
