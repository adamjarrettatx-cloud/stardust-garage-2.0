'use client';

// ---------------------------------------------------------------------------
// EntityComposer — the chat input with @user and #event autocomplete
// ---------------------------------------------------------------------------
//
// Deliberately NOT a rich text editor. It is a plain, controlled <textarea>
// whose value is exactly the sentence that gets stored, plus a parallel array of
// entity offsets, plus a read-only mirror layer painted behind the textarea that
// tints the resolved tokens.
//
// Why not contentEditable: a textarea is the only element that gets native caret
// movement, native selection, native undo, IME composition, mobile autocorrect,
// swipe-to-delete and long-press-select for free — on a phone in a dark venue,
// which is where this actually gets used. Every contentEditable editor
// reimplements those, and gets a few of them wrong. The cost of a textarea is
// that it cannot contain styled children, which the mirror solves: it wraps in
// exactly the same box with exactly the same typography, so a highlight rectangle
// lands behind the same glyphs. The mirror's own text is transparent — only the
// textarea ever paints characters, so a pixel of drift shows up as a slightly
// offset tint rather than doubled or blurry text.
//
// Token integrity lives in lib/chat-entities.js: every edit is diffed and the
// offsets remapped, and a token whose letters were edited stops being a token
// instead of silently pointing at a row the words no longer name.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  findActiveTrigger,
  insertEntity,
  remapEntities,
  removeEntity,
  entityEndingAt,
  entityStartingAt,
  searchUserCandidates,
  searchEventCandidates,
  eventContextLabel,
  userContextLabel,
  duplicateDisplayNames,
  memberInitials,
  normalizeForSearch,
} from '@/lib/chat-entities';

// Shared between the textarea and its mirror. Any divergence here shows up as
// misaligned highlights, so the two boxes read their geometry from one object
// rather than from two copies of the same Tailwind classes.
const FIELD_BOX = {
  fontSize: '14px',
  lineHeight: '20px',
  padding: '12px 16px',
  borderRadius: '12px',
  borderWidth: '1px',
  borderStyle: 'solid',
  fontFamily: 'inherit',
  letterSpacing: 'normal',
};

const MAX_FIELD_HEIGHT = 120;

// How long to wait after the last keystroke before asking the server for more
// events. The prefetched window answers most queries with no request at all;
// this only covers the older back catalogue.
const REMOTE_SEARCH_DEBOUNCE_MS = 220;

/**
 * @param {Object} props
 * @param {string} props.value                     Draft text — exactly what will be stored.
 * @param {import('@/lib/chat-entities').MessageEntity[]} props.entities
 * @param {(next: { text: string, entities: import('@/lib/chat-entities').MessageEntity[] }) => void} props.onChange
 * @param {() => void} props.onSubmit              Enter with no dropdown open.
 * @param {Array<object>} props.userCandidates     Mentionable teammates, already permission-filtered by the parent.
 * @param {Array<object>} props.eventCandidates    Events the viewer may link, already permission-filtered.
 * @param {(query: string) => void} [props.onEventSearch] Debounced remote search for events outside the prefetched window.
 * @param {boolean} [props.eventSearchLoading]
 * @param {string} [props.todayIso]
 * @param {object} props.t                         Theme palette from TeamChatClient.
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 */
export default function EntityComposer({
  value,
  entities,
  onChange,
  onSubmit,
  userCandidates = [],
  eventCandidates = [],
  onEventSearch = null,
  eventSearchLoading = false,
  todayIso = null,
  t,
  placeholder = 'Type a message…',
  disabled = false,
}) {
  const textareaRef = useRef(null);
  const mirrorRef = useRef(null);
  const listRef = useRef(null);
  // Server-render-safe unique id, so aria-controls / aria-activedescendant point
  // at this composer's own listbox even with more than one on a page.
  const listboxId = useId();

  // The trigger the caret is currently inside, or null. Recomputed on every
  // input and selection change rather than tracked incrementally, because the
  // caret can move for reasons no handler sees (a click, a drag, a phone's
  // text-selection bubble).
  const [trigger, setTrigger] = useState(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  // A caret position to apply after a programmatic text change. React has to
  // commit the new value before the selection can be set on it, so this is
  // applied in an effect rather than inline.
  const [pendingCaret, setPendingCaret] = useState(null);

  const emit = useCallback((next) => {
    onChange({ text: next.text, entities: next.entities });
    if (Number.isInteger(next.caret)) setPendingCaret(next.caret);
  }, [onChange]);

  useEffect(() => {
    if (pendingCaret == null) return;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret, value]);

  // Auto-grow to fit, capped — then the textarea scrolls and the mirror follows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_FIELD_HEIGHT);
    el.style.height = `${next}px`;
    if (mirrorRef.current) mirrorRef.current.style.height = `${next}px`;
  }, [value]);

  // ---- autocomplete results ------------------------------------------------

  const results = useMemo(() => {
    if (!trigger) return [];
    if (trigger.type === 'user') return searchUserCandidates(userCandidates, trigger.query);
    return searchEventCandidates(eventCandidates, trigger.query, { todayIso });
  }, [trigger, userCandidates, eventCandidates, todayIso]);

  // Which of the shown names collide, so only those rows pay the cost of an
  // extra email line.
  const ambiguousNames = useMemo(
    () => (trigger?.type === 'user' ? duplicateDisplayNames(results) : new Set()),
    [trigger, results]
  );

  const open = Boolean(trigger) && (results.length > 0 || (trigger.type === 'event' && eventSearchLoading));

  useEffect(() => {
    setHighlightIndex(0);
  }, [trigger?.type, trigger?.query]);

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${highlightIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open]);

  // Remote event lookup, debounced. Only fires for '#', and only once the query
  // is long enough to be meaningful — a single character would match half the
  // calendar and the prefetched window already covers it.
  useEffect(() => {
    if (!onEventSearch) return undefined;
    if (trigger?.type !== 'event') return undefined;
    const query = trigger.query.trim();
    if (query.length < 2) return undefined;

    const timer = setTimeout(() => onEventSearch(query), REMOTE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trigger?.type, trigger?.query, onEventSearch]);

  // ---- editing -------------------------------------------------------------

  const syncTrigger = useCallback((text, caret, ents) => {
    setTrigger(findActiveTrigger(text, caret, ents));
  }, []);

  const handleChange = useCallback((e) => {
    const nextText = e.target.value;
    const nextEntities = remapEntities(value, nextText, entities);
    onChange({ text: nextText, entities: nextEntities });
    syncTrigger(nextText, e.target.selectionStart, nextEntities);
  }, [value, entities, onChange, syncTrigger]);

  // The caret can move without the text changing — click, arrow keys, a mobile
  // selection handle. The dropdown has to follow it, otherwise clicking away
  // from a half-typed '@' leaves a stale menu open over the conversation.
  const handleSelect = useCallback((e) => {
    syncTrigger(value, e.target.selectionStart, entities);
  }, [value, entities, syncTrigger]);

  const choose = useCallback((result) => {
    if (!trigger) return;
    const selection = trigger.type === 'user'
      ? {
          type: 'user',
          id: result.user_id,
          label: result.full_name || result.email || 'Teammate',
        }
      : {
          type: 'event',
          id: result.id,
          label: result.title || 'Untitled event',
        };

    emit(insertEntity({ text: value, entities, trigger, selection }));
    setTrigger(null);
  }, [trigger, value, entities, emit]);

  const handleKeyDown = useCallback((e) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
        return;
      }
      // Tab commits alongside Enter: it is what muscle memory expects from an
      // autocomplete, and it is unambiguous here because the composer has no
      // other tab stop worth reaching mid-sentence.
      if (e.key === 'Enter' || e.key === 'Tab') {
        const picked = results[highlightIndex];
        if (picked) {
          e.preventDefault();
          choose(picked);
          return;
        }
      }
      if (e.key === 'Escape') {
        // Closes the menu without touching the text, so the typed '#' survives
        // as literal punctuation for anyone who meant it that way.
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }

    // Whole-token delete. A token is one referential thing, so backspacing at
    // its trailing edge removes all of it rather than shaving off a letter and
    // leaving a half-name that no longer matches the row it points at.
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? 0;
    const collapsed = el && el.selectionStart === el.selectionEnd;

    if (collapsed && e.key === 'Backspace') {
      const token = entityEndingAt(entities, caret);
      if (token) {
        e.preventDefault();
        emit(removeEntity({ text: value, entities, entity: token }));
        setTrigger(null);
        return;
      }
    }
    if (collapsed && e.key === 'Delete') {
      const token = entityStartingAt(entities, caret);
      if (token) {
        e.preventDefault();
        emit(removeEntity({ text: value, entities, entity: token }));
        setTrigger(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }, [open, results, highlightIndex, choose, entities, value, emit, onSubmit]);

  // ---- mirror --------------------------------------------------------------

  // The tinted rectangles behind the tokens. Text here is transparent; the
  // textarea on top paints every visible character.
  const mirrorSegments = useMemo(() => {
    const out = [];
    let cursor = 0;
    for (const entity of entities || []) {
      if (entity.start > cursor) out.push({ key: `t${cursor}`, text: value.slice(cursor, entity.start), entity: null });
      out.push({ key: `e${entity.start}`, text: value.slice(entity.start, entity.end), entity });
      cursor = entity.end;
    }
    if (cursor < value.length) out.push({ key: `t${cursor}`, text: value.slice(cursor), entity: null });
    return out;
  }, [value, entities]);

  const syncScroll = useCallback(() => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
      mirrorRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  return (
    <div className="relative flex-1 min-w-0">
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={trigger.type === 'user' ? 'Teammates' : 'Events'}
          className="absolute bottom-full left-0 right-0 mb-2 max-h-[240px] overflow-y-auto rounded-[12px] border shadow-lg z-30"
          style={{ background: t.panelBg, borderColor: t.borderStrong }}
        >
          <div
            className="px-3 py-2 text-[10px] font-semibold tracking-[0.12em] sticky top-0"
            style={{ color: t.muted, background: t.panelBg, borderBottom: `1px solid ${t.border}` }}
          >
            {trigger.type === 'user' ? 'MENTION A TEAMMATE' : 'LINK AN EVENT'}
          </div>

          {results.length === 0 && eventSearchLoading && (
            <p className="px-3 py-3 text-[12px]" style={{ color: t.faint }}>Searching events…</p>
          )}

          {results.map((result, index) => {
            const active = index === highlightIndex;
            const isUser = trigger.type === 'user';
            const primary = isUser
              ? (result.full_name || result.email || 'Teammate')
              : (result.title || 'Untitled event');
            const secondary = isUser
              ? userContextLabel(result, {
                  showEmail: ambiguousNames.has(normalizeForSearch(result.full_name || result.email)),
                })
              : eventContextLabel(result);

            return (
              <button
                key={isUser ? result.user_id : result.id}
                type="button"
                data-index={index}
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={active}
                // Chosen on mousedown, before the textarea can lose focus — a
                // click that blurs first would close the menu out from under
                // itself and the tap would land on nothing.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(result);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
                className="w-full text-left px-3 py-2 flex items-center gap-3 transition-colors"
                style={{ background: active ? t.activeRowBg : 'transparent' }}
              >
                {isUser && (
                  result.avatar_url ? (
                    <img
                      src={result.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                      style={{ background: t.inputBg, color: t.muted, border: `1px solid ${t.border}` }}
                    >
                      {memberInitials(result)}
                    </span>
                  )
                )}
                {!isUser && (
                  <span
                    aria-hidden="true"
                    className="w-7 h-7 rounded-[8px] flex-shrink-0 flex items-center justify-center text-[12px]"
                    style={{ background: t.inputBg, color: t.accent, border: `1px solid ${t.border}` }}
                  >
                    ◆
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: t.text }}>
                    {primary}
                  </span>
                  {secondary && (
                    <span className="block truncate text-[11px]" style={{ color: t.muted }}>
                      {secondary}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="relative">
        {/* Mirror. aria-hidden and pointer-events-none: it exists only to paint
            highlights, and must never be read out or receive a click. */}
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none"
          style={{
            ...FIELD_BOX,
            borderColor: 'transparent',
            color: 'transparent',
            background: t.inputBg,
          }}
        >
          {mirrorSegments.map((seg) => (
            seg.entity ? (
              <span
                key={seg.key}
                style={{
                  borderRadius: '5px',
                  // Padding would shift every glyph after it out of alignment
                  // with the textarea, so the tint is inset with a box-shadow
                  // instead — it bleeds slightly past the text without
                  // occupying any layout space.
                  boxShadow: `0 0 0 2px ${seg.entity.type === 'user'
                    ? 'color-mix(in srgb, ' + t.accent + ' 22%, transparent)'
                    : 'color-mix(in srgb, ' + t.accent + ' 12%, transparent)'}`,
                  background: seg.entity.type === 'user'
                    ? `color-mix(in srgb, ${t.accent} 22%, transparent)`
                    : `color-mix(in srgb, ${t.accent} 12%, transparent)`,
                }}
              >
                {seg.text}
              </span>
            ) : (
              <span key={seg.key}>{seg.text}</span>
            )
          ))}
          {/* A trailing newline is not laid out unless something follows it. */}
          {'\u200b'}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          onBlur={() => setTrigger(null)}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          // The ARIA 1.2 combobox pattern, stated explicitly: a textarea's
          // implicit `textbox` role does not support aria-expanded, so a screen
          // reader would otherwise never announce that a menu had opened, nor
          // read out the row the arrow keys are on.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && highlightIndex >= 0 ? `${listboxId}-opt-${highlightIndex}` : undefined}
          className="relative w-full resize-none outline-none block"
          style={{
            ...FIELD_BOX,
            background: 'transparent',
            borderColor: t.borderStrong,
            color: t.text,
            caretColor: t.text,
            maxHeight: `${MAX_FIELD_HEIGHT}px`,
          }}
        />
      </div>

      <p className="mt-1 text-[10px] leading-none" style={{ color: t.faint }}>
        <span style={{ color: t.muted }}>@</span> teammate · <span style={{ color: t.muted }}>#</span> event · Enter to send, Shift+Enter for a new line
      </p>
    </div>
  );
}
