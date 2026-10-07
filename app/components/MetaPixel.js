'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { trackMetaEvent } from '@/lib/meta/pixel-client';

// Mounted once in the root layout. Sends one PageView per client-side route
// change on public pages only. Off entirely unless NEXT_PUBLIC_META_PIXEL_ID
// is set; see lib/meta/policy.js for the routes Meta never sees.
export default function MetaPixel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() || '';

  useEffect(() => {
    trackMetaEvent('PageView');
  }, [pathname, search]);

  return null;
}
