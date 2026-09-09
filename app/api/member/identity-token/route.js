import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateMemberIdentityToken,
  hashMemberIdentityToken,
} from '@/lib/member-identity';
import { getOrIssueMemberIdentityToken } from '@/lib/member-identity-token-service.mjs';
import {
  MEMBER_IDENTITY_TOKEN_RATE_LIMIT,
  rateLimit,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/member/identity-token
// Returns the authenticated member's opaque QR credential. Existing tokens
// are reused until one hour before expiry; then the old credential is revoked
// and a new 90-day credential is issued.
export async function GET(request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = rateLimit({
    key: `member_identity_token:${user.id}`,
    ...MEMBER_IDENTITY_TOKEN_RATE_LIMIT,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  try {
    const result = await getOrIssueMemberIdentityToken({
      admin: createAdminClient(),
      userId: user.id,
      mintToken: () => {
        const raw = generateMemberIdentityToken();
        return { raw, hash: hashMemberIdentityToken(raw) };
      },
    });

    if (result.kind === 'not_a_member') {
      return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
    }
    if (result.kind === 'error') {
      console.error('[member.identity-token]', result.error?.message || result.error);
      return NextResponse.json({ error: 'Unable to issue member identity token' }, { status: 500 });
    }

    return NextResponse.json({
      token: result.token,
      expiresAt: result.expiresAt,
      issuedAt: result.issuedAt,
    });
  } catch (error) {
    console.error('[member.identity-token]', error?.message || error);
    return NextResponse.json({ error: 'Unable to issue member identity token' }, { status: 500 });
  }
}
