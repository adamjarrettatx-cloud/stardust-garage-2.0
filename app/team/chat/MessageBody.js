'use client';

// ---------------------------------------------------------------------------
// MessageBody — renders a sent message's text with its event links and mentions
// ---------------------------------------------------------------------------
//
// The message is reconstructed from the stored text plus the stored entity
// offsets, and every label is re-resolved from live data by id. That is the
// whole reason ids are stored instead of formatted text: rename an event on
// Thursday and every message that ever linked it reads correctly on Friday.
//
// Three states per entity, and the third one is the one that matters:
//
//   resolved + reachable   → a link (or a mention pill)
//   resolved + unreachable → styled text, no link, because /bananas/events/[id]
//                            is admin-only and a non-admin must not be sent
//                            somewhere they'll be bounced from
//   unresolved             → the label stored at send time, as plain styled text
//
// An event that was deleted, or a teammate who was removed, therefore still
// reads as a sentence. Nothing here can throw on bad metadata: segmentMessage
// validates offsets and its segments always concatenate back to the exact body
// text, so the worst case is a lost tint, never a lost word or a broken pane.

import Link from 'next/link';
import { segmentMessage, resolveEntityLabel } from '@/lib/chat-entities';
import { linkedEventHref } from '@/lib/linked-event-link';

/**
 * @param {Object} props
 * @param {string} props.bodyText
 * @param {unknown} props.entities        Raw jsonb from chat_messages.entities.
 * @param {Record<string, object>} [props.eventsById]
 * @param {Record<string, object>} [props.usersByUserId]
 * @param {boolean} [props.isAdmin]       Decides whether an event link may point at /bananas.
 * @param {string} [props.currentUserId]  The viewer — their own mention is emphasised.
 * @param {object} props.t                Theme palette from TeamChatClient.
 */
export default function MessageBody({
  bodyText,
  entities,
  eventsById = {},
  usersByUserId = {},
  isAdmin = false,
  currentUserId = null,
  t,
}) {
  const segments = segmentMessage(bodyText, entities);
  if (segments.length === 0) return null;

  return (
    <div className="text-[14px] whitespace-pre-wrap break-words mt-0.5" style={{ color: t.bodyText }}>
      {segments.map((segment, index) => {
        // React keys: the index is stable here because segments are derived
        // deterministically from (bodyText, entities) and a sent message never
        // changes either.
        const key = `${index}-${segment.kind}`;

        if (segment.kind === 'text') return <span key={key}>{segment.text}</span>;

        const { label, resolved, record } = resolveEntityLabel(segment.entity, { eventsById, usersByUserId });

        if (segment.kind === 'event') {
          const href = resolved ? linkedEventHref(record, isAdmin) : null;

          if (!href) {
            return (
              <span
                key={key}
                className="font-semibold"
                style={{ color: t.text }}
                // Only worth explaining when the record is actually gone; an
                // event the viewer simply cannot open needs no apology.
                title={resolved ? undefined : 'This event is no longer available'}
              >
                {label}
              </span>
            );
          }

          return (
            <Link
              key={key}
              href={href}
              className="font-semibold underline decoration-1 underline-offset-2 transition-opacity hover:opacity-75"
              style={{ color: t.accent }}
              title={label}
            >
              {label}
            </Link>
          );
        }

        // A mention. Rendered as an inline pill rather than a link: there is no
        // per-teammate page in the admin app to open, and the point of the
        // styling is to make being named visible at a glance while scrolling.
        const isMe = Boolean(currentUserId) && segment.entity.id === currentUserId;
        return (
          <span
            key={key}
            className="font-semibold rounded-[5px]"
            style={{
              // Inset via box-shadow rather than padding so the pill never
              // changes line-height or breaks the run of text around it.
              boxShadow: `0 0 0 2px ${isMe
                ? `color-mix(in srgb, ${t.accent} 30%, transparent)`
                : `color-mix(in srgb, ${t.accent} 16%, transparent)`}`,
              background: isMe
                ? `color-mix(in srgb, ${t.accent} 30%, transparent)`
                : `color-mix(in srgb, ${t.accent} 16%, transparent)`,
              color: resolved ? t.text : t.muted,
            }}
            title={resolved ? undefined : 'This teammate is no longer available'}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
