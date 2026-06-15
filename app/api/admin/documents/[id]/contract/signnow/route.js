import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/document-helpers';
import { isSignNowConfigured } from '@/lib/signnow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/admin/documents/:id/contract/signnow
//   Reports whether SignNow is wired up for this environment, WITHOUT making a
//   live call. The UI uses this to decide between an active "Send" button and a
//   disabled placeholder. Always 200 so the client can render either state.
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from('document_contracts')
    .select('status, signature_provider, external_envelope_id, sent_at')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    configured: isSignNowConfigured(),
    contract: contract || null,
  });
}

// POST /api/admin/documents/:id/contract/signnow  -- "send for signature".
//   This endpoint exists so the UI has a stable target, but it makes NO live
//   SignNow call when credentials are missing: it returns 503 with a clear,
//   machine-readable reason. Once SIGNNOW_API_KEY is set and lib/signnow.js is
//   implemented, this is where the real send would be invoked.
export async function POST(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from('documents')
    .select('id, category')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.category !== 'contracts') {
    return NextResponse.json({ error: 'Document is not in the contracts category' }, { status: 400 });
  }

  if (!isSignNowConfigured()) {
    return NextResponse.json(
      {
        error: 'SignNow is not configured.',
        code: 'SIGNNOW_NOT_CONFIGURED',
        hint: 'Set SIGNNOW_API_KEY (server-side, no NEXT_PUBLIC_ prefix) to enable sending. Until then, advance status manually.',
      },
      { status: 503 },
    );
  }

  // Credentials present but the live integration is still scaffolding. Be
  // explicit rather than pretending to send.
  return NextResponse.json(
    {
      error: 'SignNow send is not implemented yet.',
      code: 'SIGNNOW_NOT_IMPLEMENTED',
      hint: 'lib/signnow.js sendForSignature() is scaffolded. Implement the upload + invite calls to enable live sends.',
    },
    { status: 501 },
  );
}
