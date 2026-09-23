import { cookies } from 'next/headers';
import { PREVIEW_COOKIE, PREVIEW_DURATION, viewConfig } from '@/lib/view-portal/config';
import { viewPersona } from '@/lib/view-portal/personas';
import { verifyViewToken } from '@/lib/view-portal/tokens';

export default async function ViewPortalBanner() {
  if (process.env.VIEW_PORTAL_MODE !== 'sandbox') return null;
  let config;
  try { config = viewConfig(); } catch { return null; }
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  const session = await verifyViewToken(token, config.secret, {
    purpose: 'session', audience: config.sandboxOrigin, ownerId: config.ownerId, maxAge: PREVIEW_DURATION,
  });
  const persona = viewPersona(session?.persona);
  if (!persona) return null;
  return (
    <aside className="view-portal-banner" aria-label="Preview mode">
      <div>
        <span className="view-portal-banner__eyebrow">Isolated preview</span>
        <strong>Viewing as: {persona.label}</strong>
      </div>
      <div className="view-portal-banner__actions">
        <form action="/view-preview/exit" method="post"><button type="submit">Change view</button></form>
        <form action="/view-preview/exit" method="post"><button type="submit">Exit preview</button></form>
      </div>
    </aside>
  );
}
