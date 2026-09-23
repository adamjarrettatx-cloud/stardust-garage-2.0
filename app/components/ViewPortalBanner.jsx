import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { PREVIEW_COOKIE, PREVIEW_DURATION, viewConfig } from '@/lib/view-portal/config';
import { viewPersona } from '@/lib/view-portal/personas';
import { verifyViewToken } from '@/lib/view-portal/tokens';
import ViewPortalControls from './ViewPortalControls';

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
    <Suspense fallback={null}><ViewPortalControls label={persona.label} /></Suspense>
  );
}
