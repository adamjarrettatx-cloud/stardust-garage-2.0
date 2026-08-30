'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import { formatVenueDateTime } from '@/lib/contract-helpers';
import CreateContractDrawer from './CreateContractDrawer';

// EVENT CONTRACTS — the primary staff starting point for a contract.
//
// Mounted in the event editor's footerPanels alongside Artist Lineup and Guest
// List, because the question "what do we still need signed for Friday?" is an
// event question, not a documents-archive question. The Documents Hub remains
// the archive/compliance view.
//
// Everything here is read + navigate + create-draft. Editing fields, sending and
// status changes stay on the existing contract detail page so there is exactly
// one implementation of those.

const STATUS_STYLES = {
  draft: { color: 'var(--auth-muted)', bg: 'var(--auth-card-bg-alt)', border: 'var(--auth-card-border)' },
  pending_review: { color: 'var(--auth-warn)', bg: 'var(--auth-warn-bg)', border: 'var(--auth-warn-border)' },
  sent: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)' },
  partially_signed: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
  signed: { color: 'var(--auth-success)', bg: 'var(--auth-success-bg)', border: 'var(--auth-success-border)' },
  declined: { color: '#ff8080', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' },
  void: { color: '#ff8080', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' },
  expired: { color: 'var(--auth-warn)', bg: 'var(--auth-warn-bg)', border: 'var(--auth-warn-border)' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {String(status || 'draft').replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

export default function EventContractsPanel({ eventId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const json = await adminFetch(`/api/admin/events/${eventId}/contracts`);
      setData(json);
    } catch (err) {
      setError(err.message || 'Could not load contracts.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const sectionStyle = {
    background: 'var(--auth-card-bg)',
    borderColor: 'var(--auth-card-border)',
  };

  const organizer = data?.organizer || null;
  const contracts = data?.contracts || [];
  const canCreate =
    !!organizer && !!data?.templates_enabled && (data?.templates || []).length > 0;

  return (
    <section className="rounded-[12px] border p-5 mt-8" style={sectionStyle}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-[12px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>
          CONTRACTS {contracts.length > 0 ? `(${contracts.length})` : ''}
        </h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            CREATE CONTRACT
          </button>
        )}
      </div>
      <p className="text-[12px] mb-5" style={{ color: 'var(--auth-muted)' }}>
        Agreements for this event, with the Event Organizer as the counterparty. Start here — the
        Documents Hub is the archive.
      </p>

      {loading && (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          Loading contracts…
        </p>
      )}

      {error && (
        <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* COUNTERPARTY — who any contract on this event is with. An SDG-only
              event legitimately has nobody to sign with. */}
          <div
            className="rounded-[10px] border p-4 mb-5"
            style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
          >
            <div className="text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--auth-muted)' }}>
              EVENT ORGANIZER
            </div>
            {organizer ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/bananas/contacts/${organizer.id}`}
                    className="text-[14px] font-semibold underline"
                    style={{ color: 'var(--auth-text-strong)' }}
                  >
                    {organizer.display_label || organizer.display_name}
                  </Link>
                  {!organizer.is_event_organizer && (
                    <span
                      className="text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
                      style={{
                        color: 'var(--auth-warn)',
                        background: 'var(--auth-warn-bg)',
                        border: '1px solid var(--auth-warn-border)',
                      }}
                    >
                      NOT TAGGED EVENT ORGANIZER
                    </span>
                  )}
                </div>
                <div className="text-[12px] mt-1.5" style={{ color: 'var(--auth-muted)' }}>
                  {organizer.signer_email
                    ? `Signature requests go to ${organizer.signer_email}.`
                    : 'No signer email on this profile — contracts can be drafted but not sent.'}
                </div>
                {!organizer.legal_name && (
                  <div className="text-[12px] mt-1.5" style={{ color: 'var(--auth-warn)' }}>
                    No legal name on file. The agreement will use the display name.{' '}
                    <Link href={`/bananas/contacts/${organizer.id}`} className="underline">
                      Fix the profile
                    </Link>
                  </div>
                )}
              </>
            ) : data.event?.is_sdg_only ? (
              <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
                This is an SDG-only event — there is no outside organizer, so nothing to sign.
              </p>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--auth-warn)' }}>
                No Event Organizer linked. Set “Who is this event with?” above and save before
                creating a contract.
              </p>
            )}
          </div>

          {!data.templates_enabled && (
            <div
              className="text-[12px] p-3 rounded-[10px] border mb-5"
              style={{
                background: 'var(--auth-warn-bg)',
                borderColor: 'var(--auth-warn-border)',
                color: 'var(--auth-warn)',
              }}
            >
              Contract templates are turned off in this environment
              (CONTRACT_TEMPLATES_ENABLED), so new contracts can’t be created here yet. Existing
              contracts below are still readable.
            </div>
          )}

          {data.templates_enabled && organizer && (data.templates || []).length === 0 && (
            <div className="text-[12px] mb-5" style={{ color: 'var(--auth-muted)' }}>
              No active contract templates yet.{' '}
              <Link href="/bananas/documents/templates" className="underline">
                Add a template
              </Link>{' '}
              to start creating contracts from events.
            </div>
          )}

          {contracts.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
              No contracts on this event yet.
            </p>
          ) : (
            <div className="space-y-3">
              {contracts.map((c) => (
                <div
                  key={c.id}
                  className="rounded-[10px] border p-4"
                  style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <Link
                        href={`/bananas/documents/${c.document_id}`}
                        className="text-[14px] font-semibold underline break-words"
                        style={{ color: 'var(--auth-text-strong)' }}
                      >
                        {c.title}
                      </Link>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--auth-muted)' }}>
                        {[
                          c.template_title,
                          c.counterparty_name,
                          c.master_contract_id ? 'Under a Master Agreement' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>

                  <div className="text-[11px] mt-2.5 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--auth-faint)' }}>
                    <span>
                      {c.filled_count}/{c.field_count} field{c.field_count === 1 ? '' : 's'} filled
                    </span>
                    <span>
                      {c.signer_count} signer{c.signer_count === 1 ? '' : 's'}
                    </span>
                    {c.effective_date && <span>Effective {formatVenueDateTime(c.effective_date)}</span>}
                    {c.expiration_date && <span>Expires {formatVenueDateTime(c.expiration_date)}</span>}
                    {c.last_sent_at && (
                      <span>
                        Sent {formatVenueDateTime(c.last_sent_at)}
                        {c.send_count > 1 ? ` (${c.send_count}×)` : ''}
                      </span>
                    )}
                    {c.viewed_at && <span>Viewed {formatVenueDateTime(c.viewed_at)}</span>}
                    {c.completed_at && <span>Completed {formatVenueDateTime(c.completed_at)}</span>}
                  </div>

                  {/* Why this can't be sent yet — the same verdict the send API
                      will produce, so staff never discover it at the last step. */}
                  {c.status === 'draft' && c.blockers.length > 0 && (
                    <ul
                      className="text-[11px] mt-3 space-y-1 list-disc pl-4"
                      style={{ color: 'var(--auth-warn)' }}
                    >
                      {c.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {c.status === 'draft' && c.blockers.length === 0 && (
                    <div className="text-[11px] mt-3" style={{ color: 'var(--auth-success)' }}>
                      Ready to send — open the contract to review fields and send.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {canCreate && (
        <CreateContractDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onCreated={(json) => {
            setDrawerOpen(false);
            if (json?.document_id) {
              window.location.href = `/bananas/documents/${json.document_id}`;
              return;
            }
            load();
          }}
          event={data.event}
          organizer={organizer}
          masters={data.masters || []}
          templates={data.templates || []}
        />
      )}
    </section>
  );
}
