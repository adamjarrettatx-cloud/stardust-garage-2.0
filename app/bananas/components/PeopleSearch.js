'use client';

// Admin-wide people search (approved preview, Oct 2026). One box above every
// admin page: type a name, phone number (any format) or email and see every
// Guest account, Trial Pass, Member, Applicant and door guest who matches,
// one row per person. Backed by /api/admin/people-search.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { phoneHref } from '@/lib/phone';
import styles from './people-search.module.css';

const DEBOUNCE_MS = 220;
const FILTERS = [
  ['all', 'All'],
  ['members', 'Members'],
  ['trial', 'Trial'],
  ['applicants', 'Applicants'],
  ['guests', 'Guests'],
];

const initials = (name) => (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const isPhoneQuery = (q) => /^[\d\s()+.\-]+$/.test(q.trim());

// Underline each searched word where it appears in the name.
function Highlight({ text, query }) {
  const tokens = isPhoneQuery(query) ? [] : query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length || !text) return text;
  const lower = text.toLowerCase();
  const marks = new Array(text.length).fill(false);
  for (const t of tokens) {
    // Prefer word starts, so "h" marks the H in "Hill", not the h in "Marsha".
    const re = new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    let m; let hit = false;
    while ((m = re.exec(lower))) { const start = m.index + m[1].length; for (let i = start; i < start + t.length; i += 1) marks[i] = true; hit = true; }
    if (!hit) { const i = lower.indexOf(t); if (i >= 0) for (let k = i; k < i + t.length; k += 1) marks[k] = true; }
  }
  const out = [];
  let i = 0;
  while (i < text.length) {
    const on = marks[i]; let j = i;
    while (j < text.length && marks[j] === on) j += 1;
    out.push(on ? <span key={i} className={styles.hl}>{text.slice(i, j)}</span> : text.slice(i, j));
    i = j;
  }
  return out;
}

function Photo({ url, name }) {
  const [failed, setFailed] = useState(null);
  return (
    <div className={styles.photo} aria-hidden="true">
      {url && url !== failed ? (
        // Signed private thumbnail URLs; not routed through Next's optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} />
      ) : initials(name)}
    </div>
  );
}

function ResultRow({ person, query, active, open, onToggle, onHover }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!person.phone_display) return;
    try { await navigator.clipboard.writeText(person.phone_display); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const tone = (t) => (t && t !== 'neutral' ? styles[t] : '');
  return (
    <li id={`people-${person.id}`} role="option" aria-selected={active} className={`${styles.row} ${active ? styles.active : ''} ${open ? styles.open : ''}`} onMouseEnter={onHover}>
      <Photo url={person.photo_url} name={person.full_name} />
      <div className={styles.main}>
        <div className={styles.name}>
          <span><Highlight text={person.full_name} query={query} /></span>
          <span className={`${styles.chip} ${tone(person.status.tone)}`}>{person.status.label}</span>
          {person.also.map((c) => <span key={c.label} className={`${styles.chip} ${tone(c.tone)}`}>{c.label}</span>)}
        </div>
        <div className={styles.contact}>
          {person.phone_display ? <a className={styles.phone} href={phoneHref(person.phone)}>{person.phone_display}</a> : <span>No phone</span>}
          {person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : <span>No email</span>}
        </div>
        {person.context ? <div className={styles.ctx}>{person.context}</div> : null}
      </div>
      <div className={styles.actions}>
        {person.phone_display ? (
          <>
            <button type="button" className={`${styles.btn} ${styles.copyBtn}`} onClick={copy}>{copied ? 'Copied' : 'Copy phone'}</button>
            <a className={`${styles.btn} ${styles.callBtn}`} href={phoneHref(person.phone)}>Call</a>
          </>
        ) : null}
        {person.href ? (
          <Link className={styles.btn} href={person.href}>{person.hrefLabel || 'Open'}</Link>
        ) : person.details?.length ? (
          <button type="button" className={styles.btn} aria-expanded={open} onClick={onToggle}>{open ? 'Hide details' : 'Details'}</button>
        ) : null}
      </div>
      {open && !person.href && person.details?.length ? (
        <dl className={styles.details}>
          {person.details.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export default function PeopleSearch() {
  const router = useRouter();
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = nothing searched
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [active, setActive] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [showPanel, setShowPanel] = useState(false);

  // Debounced fetch; a newer keystroke aborts the older request.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoading(false); setError(null); return undefined; }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/people-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(res.status === 401 ? 'Your session expired. Sign in again.' : 'Search failed. Try again.');
        const json = await res.json();
        setResults(json.results || []);
        setError(null);
        setActive(0);
        setOpenId(null);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || 'Search failed.');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query]);

  // "/" focuses the search from anywhere on the page (not while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Clicking outside closes the panel; the query stays for when you return.
  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowPanel(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const counts = useMemo(() => {
    const c = { all: results?.length || 0, members: 0, trial: 0, applicants: 0, guests: 0 };
    for (const p of results || []) for (const cat of p.categories) c[cat] = (c[cat] || 0) + 1;
    return c;
  }, [results]);
  const visible = useMemo(
    () => (results || []).filter((p) => filter === 'all' || p.categories.includes(filter)),
    [results, filter],
  );

  const clear = useCallback(() => { setQuery(''); setResults(null); setFilter('all'); inputRef.current?.focus(); }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { if (query) clear(); else { inputRef.current?.blur(); setShowPanel(false); } return; }
    if (!visible.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(visible.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const p = visible[active];
      if (!p) return;
      if (p.href) { setShowPanel(false); router.push(p.href); }
      else setOpenId((id) => (id === p.id ? null : p.id));
    }
  };

  useEffect(() => {
    const p = visible[active];
    if (p) document.getElementById(`people-${p.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, visible]);

  const q = query.trim();
  const panelOpen = showPanel && q.length >= 2;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.bar}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowPanel(true); }}
          onFocus={() => setShowPanel(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people by name, phone or email"
          aria-label="Search people by name, phone or email"
          role="combobox"
          aria-expanded={panelOpen}
          aria-controls="people-search-results"
          aria-activedescendant={panelOpen && visible[active] ? `people-${visible[active].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {query ? <button type="button" className={styles.clear} onClick={clear}>Clear</button> : <span className={styles.kbd}>/</span>}
      </div>

      {panelOpen ? (
        <div className={styles.panel}>
          <div className={styles.head}>
            <span aria-live="polite">
              {error ? error
                : results === null || (loading && !results) ? 'Searching…'
                : `${results.length === 30 ? '30+' : results.length} ${results.length === 1 ? 'person matches' : 'people match'} “${q}”${loading ? ' · updating…' : ''}`}
            </span>
            {results?.length ? (
              <div className={styles.filters} role="group" aria-label="Filter results">
                {FILTERS.map(([id, label]) => (counts[id] || id === 'all' ? (
                  <button key={id} type="button" className={styles.filter} aria-pressed={filter === id} onClick={() => { setFilter(id); setActive(0); }}>
                    {label} {counts[id] || 0}
                  </button>
                ) : null))}
              </div>
            ) : null}
          </div>
          <div className={styles.scroll}>
            {results && !results.length && !loading && !error ? (
              <div className={styles.empty}>No one matches “{q}”. Try part of a first or last name, the last digits of a phone number, or an email.</div>
            ) : (
              <ul className={styles.list} id="people-search-results" role="listbox" aria-label="People">
                {visible.map((p, i) => (
                  <ResultRow
                    key={p.id}
                    person={p}
                    query={q}
                    active={i === active}
                    open={openId === p.id}
                    onHover={() => setActive(i)}
                    onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className={styles.foot}>
            <span>Searches every Guest, Trial Pass, Member, Applicant and door guest</span>
            <span className={styles.keys}>↑↓ to move · Enter to open · Esc to clear</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
