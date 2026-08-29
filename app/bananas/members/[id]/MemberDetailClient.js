'use client';

import Link from 'next/link';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import AdminMemberActions from '../AdminMemberActions';
import MemberAvatar from '../MemberAvatar';
import { formatMemberDate, memberStatusLabel, memberStatusTone } from '../member-display';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatHour(hour) {
  if (hour === null || hour === undefined) return '—';
  const h = Number(hour);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

function money(cents) {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Card({ title, count, children }) {
  return (
    <section
      className="rounded-[14px] border p-6 mb-4"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <h2
        className="text-[11px] font-semibold tracking-[0.18em] mb-5"
        style={{ color: 'var(--auth-muted)' }}
      >
        {title}
        {typeof count === 'number' ? ` (${count})` : ''}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[0.16em] mb-1" style={{ color: 'var(--auth-faint)' }}>
        {label}
      </div>
      <div
        className={`text-[14px] break-words ${mono ? 'font-mono text-[12px]' : ''}`}
        style={{ color: 'var(--auth-text)' }}
      >
        {value || '—'}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return (
    <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
      {children}
    </p>
  );
}

function Row({ children }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 py-3 border-b last:border-b-0"
      style={{ borderColor: 'var(--auth-row-border)' }}
    >
      {children}
    </div>
  );
}

function Pill({ label, bg, fg }) {
  return (
    <span
      className="text-[10px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}

export default function MemberDetailClient({ member, application, tickets, eventsById, bookings, trialPass }) {
  const tone = memberStatusTone(member.subscription_status);
  const displayName = member.full_name || member.email || 'Member';
  const checkedIn = tickets.filter((t) => t.checked_in).length;

  return (
    <>
      <AuthenticatedPageHeader
        backHref="/bananas/members"
        backLabel="← BACK TO MEMBERS"
        title={displayName}
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      {/* Identity + subscription summary */}
      <section
        className="rounded-[14px] border p-6 mb-4 flex flex-wrap items-start gap-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <MemberAvatar member={member} size="w-20 h-20" textClass="text-[24px]" />

        <div className="flex-1 min-w-[220px]">
          <div
            className="text-[20px] font-bold mb-1"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--auth-text-strong)' }}
          >
            {displayName}
          </div>
          <div className="text-[13px] mb-4" style={{ color: 'var(--auth-muted)' }}>
            {member.email}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill label={memberStatusLabel(member.subscription_status)} bg={tone.bg} fg={tone.fg} />
            <Pill
              label={member.is_active ? 'ACCESS ON' : 'ACCESS OFF'}
              bg={member.is_active ? 'var(--auth-success-bg)' : 'var(--auth-hover-bg-strong)'}
              fg={member.is_active ? 'var(--auth-success)' : 'var(--auth-muted-strong)'}
            />
            {member.cancel_at_period_end && (
              <Pill label="WILL CANCEL AT PERIOD END" bg="var(--auth-warn-bg)" fg="var(--auth-warn)" />
            )}
            {member.expo_push_token && (
              <Pill label="MOBILE APP LINKED" bg="var(--auth-info-bg)" fg="var(--auth-info)" />
            )}
          </div>
        </div>

        {member.subscription_status === 'active' &&
          !member.cancel_at_period_end &&
          member.stripe_subscription_id && (
            <div className="flex-shrink-0">
              <AdminMemberActions memberId={member.id} />
            </div>
          )}
      </section>

      <Card title="MEMBERSHIP">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          <Field
            label="PLAN"
            value={
              member.subscription_plan
                ? PLAN_DISPLAY[member.subscription_plan] || member.subscription_plan
                : 'No plan'
            }
          />
          <Field label="BILLING PERIOD" value={member.subscription_period} />
          <Field label="NEXT RENEWAL" value={formatMemberDate(member.current_period_end)} />
          <Field label="MEMBER SINCE" value={formatMemberDate(member.created_at)} />
          <Field label="STRIPE CUSTOMER" value={member.stripe_customer_id} mono />
          <Field label="STRIPE SUBSCRIPTION" value={member.stripe_subscription_id} mono />
          <Field label="AUTH USER ID" value={member.user_id} mono />
          <Field label="PROFILE ID" value={member.id} mono />
        </div>
      </Card>

      <Card title="APPLICATION">
        {!application ? (
          <Empty>No application on file for this member.</Empty>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              <Field label="APPLIED FOR" value={PLAN_DISPLAY[application.plan] || application.plan} />
              <Field label="SUBMITTED" value={formatMemberDate(application.created_at)} />
              <Field label="STATUS" value={(application.status || '').toUpperCase()} />
              <Field label="PREFERRED NAME" value={application.preferred_name} />
              <Field label="PHONE" value={application.phone} />
              <Field label="BIRTHDAY" value={application.birthday} />
              <Field label="SOCIAL" value={application.social_handle} />
              <Field label="WEBSITE" value={application.website} />
              <Field label="HOW THEY HEARD" value={application.how_did_you_hear} />
            </div>

            {[
              ['WHY STARDUST', application.why_stardust],
              ['HOW THEY WANT TO CONTRIBUTE', application.how_contribute],
              ['EXPERIENCES THEY WANT', application.what_experiences],
            ]
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <div key={label}>
                  <div
                    className="text-[10px] font-semibold tracking-[0.16em] mb-1"
                    style={{ color: 'var(--auth-faint)' }}
                  >
                    {label}
                  </div>
                  <p
                    className="text-[14px] leading-[1.6] whitespace-pre-wrap"
                    style={{ color: 'var(--auth-text)' }}
                  >
                    {v}
                  </p>
                </div>
              ))}

            <div className="flex flex-wrap gap-2">
              {[
                ['ETHOS', application.agreed_ethos],
                ['RENEWAL TERMS', application.agreed_renewal],
                ['HOUSE RULES', application.agreed_house_rules],
              ].map(([label, agreed]) => (
                <Pill
                  key={label}
                  label={`${agreed ? '✓' : '✕'} ${label}`}
                  bg={agreed ? 'var(--auth-success-bg)' : 'var(--auth-danger-bg)'}
                  fg={agreed ? 'var(--auth-success)' : 'var(--auth-danger)'}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="EVENT TICKETS" count={tickets.length}>
        {tickets.length === 0 ? (
          <Empty>No tickets attributed to this member yet.</Empty>
        ) : (
          <>
            <p className="text-[12px] mb-3" style={{ color: 'var(--auth-faint)' }}>
              {checkedIn} of {tickets.length} checked in at the door.
            </p>
            {tickets.map((t) => {
              const ev = t.local_event_id ? eventsById[t.local_event_id] : null;
              const voided = t.status === 'void' || t.order_status === 'canceled';
              return (
                <Row key={t.id}>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--auth-text-strong)' }}>
                      {ev?.title || t.tt_event_id || 'Unlinked event'}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
                      {[t.description, ev?.event_date ? formatMemberDate(ev.event_date) : null]
                        .filter(Boolean)
                        .join(' · ') || formatMemberDate(t.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {voided ? (
                      <Pill label="VOID" bg="var(--auth-danger-bg)" fg="var(--auth-danger)" />
                    ) : t.checked_in ? (
                      <Pill label="CHECKED IN" bg="var(--auth-success-bg)" fg="var(--auth-success)" />
                    ) : (
                      <Pill label="NOT SCANNED" bg="var(--auth-hover-bg-strong)" fg="var(--auth-muted-strong)" />
                    )}
                    {ev?.slug && (
                      <Link
                        href={`/bananas/events/${t.local_event_id}`}
                        className="auth-theme-page-link text-[11px] font-semibold tracking-[0.12em]"
                      >
                        EVENT →
                      </Link>
                    )}
                  </div>
                </Row>
              );
            })}
          </>
        )}
      </Card>

      <Card title="STUDIO BOOKINGS" count={bookings.length}>
        {bookings.length === 0 ? (
          <Empty>No studio bookings yet.</Empty>
        ) : (
          bookings.map((b) => {
            const cancelled = b.status === 'cancelled' || b.cancelled_at;
            return (
              <Row key={b.id}>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--auth-text-strong)' }}>
                    {formatMemberDate(b.booking_date)} · {formatHour(b.start_hour)}–{formatHour(b.end_hour)}
                  </div>
                  <div className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
                    {money(b.total_cost_cents)}
                    {b.notes ? ` · ${b.notes}` : ''}
                  </div>
                </div>
                <Pill
                  label={(cancelled ? 'CANCELLED' : b.status || 'BOOKED').toUpperCase()}
                  bg={cancelled ? 'var(--auth-danger-bg)' : 'var(--auth-success-bg)'}
                  fg={cancelled ? 'var(--auth-danger)' : 'var(--auth-success)'}
                />
              </Row>
            );
          })
        )}
      </Card>

      {trialPass && (
        <Card title="TRIAL PASS ORIGIN">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            <Field label="STATUS" value={(trialPass.status || '').toUpperCase()} />
            <Field label="SOURCE" value={trialPass.source} />
            <Field label="ISSUED" value={formatDateTime(trialPass.issued_at)} />
            <Field
              label="EXPIRED / EXTENDED TO"
              value={formatDateTime(trialPass.extended_until || trialPass.expires_at)}
            />
            <Field label="CONVERTED TO MEMBER" value={formatDateTime(trialPass.converted_at)} />
          </div>
        </Card>
      )}
    </>
  );
}
