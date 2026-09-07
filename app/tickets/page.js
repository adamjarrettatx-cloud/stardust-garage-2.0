// app/tickets/page.js
//
// Legacy /tickets URL. When the Stardust-account ticket hub landed the
// canonical wallet moved to /account/tickets; anything still pointing at
// /tickets (old confirmation emails, bookmarks, share links) gets a
// server-side 307 redirect so no user-facing dead end exists.
//
// Query string is preserved verbatim in case the caller included tracking
// params or a specific order highlight that /account/tickets ever grows
// support for.

import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function LegacyTicketsRedirect({ searchParams }) {
  const params = (await searchParams) || {};
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((one) => usp.append(k, String(one)));
    else if (v != null) usp.set(k, String(v));
  }
  const query = usp.toString();
  redirect(query ? `/account/tickets?${query}` : '/account/tickets');
}
