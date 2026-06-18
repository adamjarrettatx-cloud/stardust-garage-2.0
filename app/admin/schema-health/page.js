import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { getSchemaHealth } from '@/lib/schema-health';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Admin-only read-out of whether production's schema matches what the deployed
// code requires. This is the in-app counterpart to `npm run check:schema` and
// exists for the same reason: PR #28 deployed visibility-dependent code before
// the migration was applied, blanking public events. An admin can glance here
// after a deploy to confirm the DB caught up.
//
// Gated with adminPageGate() (same as /admin) so it honors admin-MFA
// enforcement when ENFORCE_ADMIN_MFA is on, rather than a bare admin check.
export default async function SchemaHealthPage() {
  const { redirect: gateRedirect } = await adminPageGate();
  if (gateRedirect) redirect(gateRedirect);

  const health = await getSchemaHealth();

  let statusLabel;
  let statusColor;
  if (health.configured === false) {
    statusLabel = 'NOT CONFIGURED';
    statusColor = '#8a8a8a';
  } else if (health.ok === true) {
    statusLabel = 'HEALTHY';
    statusColor = '#7ee081';
  } else if (health.ok === false) {
    statusLabel = 'SCHEMA DRIFT';
    statusColor = '#ff8b6b';
  } else {
    statusLabel = 'UNKNOWN';
    statusColor = '#ffd599';
  }

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1
          className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Schema Health
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: statusColor }}>
          {statusLabel}
        </div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: '#8a8a8a' }}>
        Verifies that production&apos;s database has the columns and tables the
        deployed code depends on. Checked <strong>{health.checked}</strong> required
        object(s). Run <code>npm run check:schema</code> for the same check from CI/CLI.
      </p>

      {health.configured === false && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(138,138,138,0.1)', border: '1px solid rgba(138,138,138,0.3)', color: '#bcbcbc' }}
        >
          Supabase server credentials are not configured in this environment, so
          the schema could not be checked. This is expected in local/preview
          builds without <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </div>
      )}

      {health.probeErrors.length > 0 && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(255,184,77,0.1)', border: '1px solid rgba(255,184,77,0.3)', color: '#ffd599' }}
        >
          <strong>Could not verify the schema.</strong> One or more probes failed:
          <ul className="mt-2 list-disc pl-5">
            {health.probeErrors.map((pe) => (
              <li key={pe.key}>
                {pe.key}: {pe.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {health.ok === false && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.35)', color: '#ffb3a1' }}
        >
          <strong>{health.missing.length} required object(s) are missing.</strong>{' '}
          The deployed code expects these — apply the matching Supabase
          migration(s) immediately. See <code>docs/deployment-checklist.md</code>.
          <ul className="mt-3 space-y-2">
            {health.missing.map((m) => (
              <li key={m.key}>
                <span className="font-mono">{m.key}</span>
                {m.since ? (
                  <span style={{ color: '#bcbcbc' }}> — {m.since}</span>
                ) : null}
                {m.note ? (
                  <div className="text-[12px]" style={{ color: '#bcbcbc' }}>
                    {m.note}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {health.ok === true && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(126,224,129,0.1)', border: '1px solid rgba(126,224,129,0.3)', color: '#aee8b0' }}
        >
          All required schema objects are present. The database matches what the
          deployed code depends on.
        </div>
      )}
    </main>
  );
}
