import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { listTeamConversations } from '@/lib/submission-conversations';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

// Every submission conversation in one compact list, newest activity first.
// Rows open the submission itself, where the conversation panel lives next to
// the original details and Team Notes.
const FILTERS = [
  { id: 'awaiting', label: 'Needs reply' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function stateLabel(c) {
  if (c.status === 'closed') return { text: 'Closed', color: 'var(--auth-muted)' };
  if (c.awaiting_team) return { text: 'Needs reply', color: 'var(--auth-warn-strong)' };
  if (!c.joined) return { text: 'Invite sent', color: 'var(--auth-muted-strong)' };
  if (c.waiting_on === 'guest') return { text: 'Waiting on them', color: 'var(--auth-muted-strong)' };
  return { text: 'Open', color: 'var(--auth-muted-strong)' };
}

export default async function ConversationsPage({ searchParams }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);
  const params = await searchParams;
  const filter = FILTERS.some((f) => f.id === params?.filter) ? params.filter : 'open';
  const result = await listTeamConversations({ filter });
  const rows = result.status === 200 ? result.body.conversations : [];

  return (
    <>
      <AuthenticatedPageHeader
        title="Conversations"
        description="Follow-ups with people who sent inquiries, collaborations and applications."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      <nav aria-label="Filter conversations" className="flex gap-2 flex-wrap mb-5">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/bananas/conversations?filter=${f.id}`}
            aria-current={filter === f.id ? 'page' : undefined}
            className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold tracking-[0.08em]"
            style={filter === f.id
              ? { background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }
              : { background: 'var(--auth-card-bg-alt)', border: '1px solid var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            {f.label.toUpperCase()}
          </Link>
        ))}
      </nav>

      {result.status !== 200 ? (
        <p className="text-[13px]" role="alert" style={{ color: 'var(--auth-danger)' }}>{result.body?.error || 'Could not load conversations.'}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-[14px] p-10 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p style={{ color: 'var(--auth-muted)' }}>
            {filter === 'awaiting' ? 'Nobody is waiting on a reply.' : 'No conversations here yet. Open a submission and use Invite to SDG to start one.'}
          </p>
        </div>
      ) : (
        <ul className="rounded-[14px] border overflow-hidden" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          {rows.map((c, idx) => {
            const s = stateLabel(c);
            return (
              <li key={c.id} style={idx ? { borderTop: '1px solid var(--auth-card-border)' } : undefined}>
                <Link href={`${c.href}#conversation`} className="flex items-center gap-4 px-5 py-3.5 hover:opacity-90">
                  <span aria-hidden="true" className="flex-shrink-0 rounded-full" style={{ width: 8, height: 8, background: c.awaiting_team && c.status === 'open' ? 'var(--auth-accent)' : 'transparent' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--auth-text-strong)' }}>{c.subject}</div>
                    <div className="text-[12px] truncate" style={{ color: 'var(--auth-muted)' }}>
                      {c.type_label} · {c.participant_name || c.invite_email}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[11px] font-semibold tracking-[0.06em]" style={{ color: s.color }}>{s.text}</div>
                    <div className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>{formatWhen(c.last_activity_at)}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
