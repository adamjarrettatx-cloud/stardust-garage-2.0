'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { htmlToPlainText } from '@/lib/rich-text-plain';

// Small formatting editor for event descriptions: bold, italic, underline,
// strikethrough, bulleted/numbered lists, links and clear formatting.
// Keyboard shortcuts (Cmd/Ctrl+B, I, U) work natively. Pasted content is
// inserted as plain text so outside styling (fonts, colors, sizes) never
// leaks in. The website re-sanitizes the HTML on every render.
//
// onChange receives { html, text }: html for events.description_html, text
// for the plain events.description every other surface reads.

const Icon = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const TOOLS = [
  { cmd: 'bold', label: 'Bold', shortcut: '⌘B', icon: <Icon><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" /><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" /></Icon> },
  { cmd: 'italic', label: 'Italic', shortcut: '⌘I', icon: <Icon><path d="M19 5h-8M13 19H5M15 5 9 19" /></Icon> },
  { cmd: 'underline', label: 'Underline', shortcut: '⌘U', icon: <Icon><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" /></Icon> },
  { cmd: 'strikeThrough', label: 'Strikethrough', icon: <Icon><path d="M4 12h16M16 6.5C15.2 5 13.7 4 12 4c-2.5 0-4.5 1.5-4.5 3.7 0 1.6 1 2.6 2.6 3.3M8 17.5C8.8 19 10.3 20 12 20c2.5 0 4.5-1.5 4.5-3.7 0-.8-.2-1.4-.6-2" /></Icon> },
  { sep: true },
  { cmd: 'insertUnorderedList', label: 'Bulleted list', icon: <Icon><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></Icon> },
  { cmd: 'insertOrderedList', label: 'Numbered list', icon: <Icon><path d="M10 6h10M10 12h10M10 18h10M4 4.5 5 4v4M3.8 14.2c.3-.6.9-.9 1.5-.7.7.2 1 1 .5 1.6L4 17.5h2.2" /></Icon> },
  { sep: true },
  { cmd: 'link', label: 'Add link', icon: <Icon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon> },
  { cmd: 'unlink', label: 'Remove link', icon: <Icon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /><path d="M3 3l18 18" /></Icon> },
  { cmd: 'removeFormat', label: 'Clear formatting', icon: <Icon><path d="M6 5h12M12 5 8.5 19M15 15l5 5M20 15l-5 5" /></Icon> },
];

const STATEFUL = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'];

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

export default function RichTextEditor({ initialHtml = '', onChange, placeholder = '', minHeight = 120, className = '', style = {} }) {
  const ref = useRef(null);
  const [active, setActive] = useState({});
  const [empty, setEmpty] = useState(!initialHtml);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml || '';
    setEmpty(!htmlToPlainText(initialHtml || ''));
    // Seed once; afterwards the DOM is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    const html = ref.current?.innerHTML || '';
    const text = htmlToPlainText(html);
    setEmpty(!text);
    onChange?.({ html: text ? html : '', text });
  }, [onChange]);

  const refreshActive = useCallback(() => {
    if (typeof document === 'undefined' || !ref.current) return;
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode || !ref.current.contains(sel.anchorNode)) return;
    const next = {};
    for (const cmd of STATEFUL) {
      try { next[cmd] = document.queryCommandState(cmd); } catch { next[cmd] = false; }
    }
    setActive(next);
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshActive);
    return () => document.removeEventListener('selectionchange', refreshActive);
  }, [refreshActive]);

  const run = (cmd) => {
    ref.current?.focus();
    if (cmd === 'link') {
      const sel = document.getSelection();
      const selectedText = sel ? sel.toString() : '';
      const url = normalizeUrl(window.prompt('Link URL', 'https://'));
      if (!url || url === 'https://') return;
      if (selectedText) {
        document.execCommand('createLink', false, url);
      } else {
        const label = url.replace(/^mailto:/i, '');
        document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${label.replace(/</g, '&lt;')}</a>&nbsp;`);
      }
    } else if (cmd === 'removeFormat') {
      document.execCommand('removeFormat');
      document.execCommand('unlink');
    } else {
      document.execCommand(cmd);
    }
    refreshActive();
    emit();
  };

  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  };

  return (
    <div className={'rounded-[10px] border overflow-hidden ' + className} style={style}>
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b"
        style={{ borderColor: 'inherit' }}
      >
        {TOOLS.map((tool, i) =>
          tool.sep ? (
            <span key={`sep-${i}`} className="mx-1 h-5 w-px" style={{ background: 'currentColor', opacity: 0.18 }} />
          ) : (
            <button
              key={tool.cmd}
              type="button"
              title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              aria-label={tool.label}
              aria-pressed={STATEFUL.includes(tool.cmd) ? !!active[tool.cmd] : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(tool.cmd)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-[6px] transition-colors"
              style={{
                background: active[tool.cmd] ? 'var(--auth-accent)' : 'transparent',
                color: active[tool.cmd] ? 'var(--auth-accent-text)' : 'inherit',
              }}
            >
              {tool.icon}
            </button>
          )
        )}
      </div>
      <div className="relative">
        {empty && placeholder && (
          <div className="pointer-events-none absolute left-5 top-3.5 text-[14px]" style={{ opacity: 0.45 }}>
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Description"
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          className="px-5 py-3.5 text-[14px] leading-[1.6] outline-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:underline [&_p]:m-0"
          style={{ minHeight, resize: 'vertical', overflow: 'auto' }}
        />
      </div>
    </div>
  );
}
