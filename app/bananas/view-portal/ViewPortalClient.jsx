'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { viewOptions, VIEW_GROUP_DESCRIPTIONS } from '@/lib/view-portal/personas';

const ALL = 'All';

function ArrowIcon({ className = 'size-[14px]' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 3h7v7M13 3 5 11" />
    </svg>
  );
}

function selectedLabel(option, persona) {
  if (!option || !persona) return '';
  return option.scenarios.length > 1 ? `${option.label} · ${persona.scenario || persona.label}` : option.label;
}

export default function ViewPortalClient({ personas, ready, statusMessage, taxonomyNote }) {
  const [selected, setSelected] = useState(personas[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(ALL);
  const [query, setQuery] = useState('');
  const [showNote, setShowNote] = useState(false);
  const noteId = useId();
  const rootRef = useRef(null);
  const launchRef = useRef(null);
  const pinned = usePinnedBar(rootRef, launchRef);
  const options = useMemo(() => viewOptions(personas), [personas]);
  const groups = useMemo(() => Array.from(new Set(options.map((p) => p.group))), [options]);
  const chosen = personas.find((persona) => persona.id === selected);
  const chosenOption = options.find((option) => option.scenarios.some((p) => p.id === selected));

  const needle = query.trim().toLowerCase();
  const visible = options.filter((option) => {
    if (filter !== ALL && option.group !== filter) return false;
    if (!needle) return true;
    const haystack = [option.label, option.description, option.group,
      ...option.scenarios.flatMap((p) => [p.label, p.scenario, p.path])].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  });
  const visibleGroups = groups.filter((group) => visible.some((option) => option.group === group));

  async function launch(personaId = selected) {
    if (!personaId) return;
    setSelected(personaId);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/view-portal/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: personaId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open preview');
      // POST the one-time credential into a new, independently cookie-scoped hostname.
      const form = document.createElement('form');
      form.method = 'POST'; form.action = data.action; form.target = '_blank';
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'token'; input.value = data.token;
      form.append(input); document.body.append(form); form.submit(); form.remove();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }

  const launchDisabled = !ready || busy || !chosen;

  return (
    <div ref={rootRef} className="pb-24 lg:pb-0">
      {/* Desktop: once the header's launch control scrolls away, a compact copy
          pins to the top of the content column. (The site body is a scroll
          container, so CSS position: sticky cannot be used here.) */}
      <div aria-hidden={!pinned.visible} inert={!pinned.visible}
        className={`vp-bar hidden lg:block fixed inset-x-0 top-0 z-30 border-b transition-[opacity,transform] duration-200 motion-reduce:transition-none ${pinned.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
        style={{ borderColor: 'var(--auth-card-border)' }}>
        <div className="flex items-center justify-between gap-6 h-16" style={{ marginLeft: pinned.left, width: pinned.width }}>
          <span className="text-[16px] font-extrabold -tracking-[.01em]" style={{ color: 'var(--auth-text)' }}>View Portal</span>
          <LaunchControl option={chosenOption} persona={chosen} busy={busy} disabled={launchDisabled} onLaunch={() => launch()} />
        </div>
      </div>

      <header className="pt-2 pb-5 border-b" style={{ borderColor: 'var(--auth-card-border)' }}>
        <p className="text-[11px] uppercase tracking-[.14em] font-extrabold" style={{ color: 'var(--auth-accent-strong)' }}>Owner only</p>
        <div className="mt-1.5 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 lg:gap-8">
          <div className="min-w-0 max-w-[560px]">
            <h1 className="text-[28px] font-extrabold -tracking-[.02em] leading-tight" style={{ color: 'var(--auth-text)' }}>View Portal</h1>
            <p className="mt-2 text-[14px] leading-[22px]" style={{ color: 'var(--auth-muted)' }}>
              Walk the complete website as a fixed synthetic account. Each view runs on an isolated hostname and database, enforced by its real permissions.
            </p>
            {taxonomyNote && (
              <button type="button" aria-expanded={showNote} aria-controls={noteId} onClick={() => setShowNote((v) => !v)}
                className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:underline underline-offset-2"
                style={{ color: 'var(--auth-muted)' }}>
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-[14px]">
                  <circle cx="8" cy="8" r="6.25" /><path d="M8 7.2v4M8 4.9v.1" strokeLinecap="round" />
                </svg>
                How profile types are organized
              </button>
            )}
          </div>
          <div ref={launchRef} className="hidden lg:flex flex-col items-end gap-2 shrink-0">
            <LaunchControl option={chosenOption} persona={chosen} busy={busy} disabled={launchDisabled} onLaunch={() => launch()} />
            <LaunchNote />
          </div>
        </div>
        {showNote && taxonomyNote && (
          <p id={noteId} className="mt-4 max-w-[760px] rounded-[10px] border px-4 py-3 text-[13px] leading-[20px]"
            style={{ borderColor: 'var(--auth-card-border)', background: 'var(--auth-card-bg)', color: 'var(--auth-muted)' }}>
            {taxonomyNote}
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] lg:text-right" style={{ color: 'var(--auth-danger)' }}>{error}</p>}
      </header>

      {!ready && (
        <div role="status" className="mt-5 rounded-[10px] border px-4 py-3" style={{ borderColor: 'var(--auth-warn-border)', background: 'var(--auth-warn-bg)' }}>
          <span className="text-[11px] uppercase tracking-[.14em] font-extrabold" style={{ color: 'var(--auth-warn)' }}>Launch locked</span>
          <p className="mt-1 text-[14px] leading-6" style={{ color: 'var(--auth-text)' }}>{statusMessage}</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-5 mb-1 flex flex-col-reverse sm:flex-row sm:items-center gap-3">
        <div role="toolbar" aria-label="Filter by group" className="flex gap-0.5 overflow-x-auto -mx-1 px-1 sm:-ml-[11px] sm:mx-0 sm:px-0">
          {[ALL, ...groups].map((group) => {
            const on = group === filter;
            return (
              <button key={group} type="button" aria-pressed={on} onClick={() => setFilter(group)}
                className="h-[30px] px-[11px] rounded-full border text-[13px] font-semibold whitespace-nowrap transition-colors"
                style={{ borderColor: on ? 'var(--auth-card-border-strong)' : 'transparent', background: on ? 'var(--auth-card-bg)' : 'transparent', color: on ? 'var(--auth-text)' : 'var(--auth-muted)' }}>
                {group}
              </button>
            );
          })}
        </div>
        <label className="relative sm:ml-auto sm:w-[200px] shrink-0">
          <span className="sr-only">Search views</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
            className="absolute left-[11px] top-[10px] size-4 pointer-events-none" style={{ color: 'var(--auth-faint)' }}>
            <circle cx="7" cy="7" r="4.75" /><path d="m10.5 10.5 3 3" strokeLinecap="round" />
          </svg>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search views"
            className="w-full h-9 rounded-lg border pl-[34px] pr-3 text-[14px] outline-none focus:ring-2"
            style={{ borderColor: 'var(--auth-input-border)', background: 'var(--auth-input-bg)', color: 'var(--auth-input-text)', '--tw-ring-color': 'var(--auth-accent)' }} />
        </label>
      </div>

      {/* Grouped list */}
      <div role="radiogroup" aria-label="Preview view">
        {visibleGroups.length === 0 && (
          <p className="mt-8 text-[14px]" style={{ color: 'var(--auth-muted)' }}>No views match “{query}”.</p>
        )}
        {visibleGroups.map((group) => {
          const rows = visible.filter((option) => option.group === group);
          return (
            <section key={group} className="mt-[22px]" aria-labelledby={`vp-group-${group}`}>
              <div className="flex items-baseline gap-2.5 mx-0.5 mb-2">
                <h2 id={`vp-group-${group}`} className="text-[11px] uppercase tracking-[.14em] font-extrabold" style={{ color: 'var(--auth-muted)' }}>{group}</h2>
                <span className="text-[11.5px] font-semibold" style={{ color: 'var(--auth-faint)' }}>{rows.length}</span>
              </div>
              {VIEW_GROUP_DESCRIPTIONS[group] && (
                <p className="-mt-0.5 mb-2.5 mx-0.5 max-w-[760px] text-[12.5px] leading-[19px]" style={{ color: 'var(--auth-muted)' }}>{VIEW_GROUP_DESCRIPTIONS[group]}</p>
              )}
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--auth-card-border)', background: 'var(--auth-card-bg)' }}>
                {rows.map((option, index) => (
                  <ViewRow key={option.id} option={option} first={index === 0} selected={selected}
                    onSelect={setSelected} onLaunch={launch} disabled={!ready || busy} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Mobile: thumb-reach launch bar */}
      <div className="vp-bar lg:hidden fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
        style={{ borderColor: 'var(--auth-card-border-strong)' }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-[.12em] font-bold" style={{ color: 'var(--auth-faint)' }}>Viewing as</div>
            <div className="text-[14px] font-bold truncate" style={{ color: 'var(--auth-text)' }}>{selectedLabel(chosenOption, chosen)}</div>
          </div>
          <button type="button" disabled={launchDisabled} onClick={() => launch()}
            className="h-11 px-4 rounded-[10px] text-[14px] font-bold inline-flex items-center gap-2 shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}>
            {busy ? 'Opening…' : 'Open preview'}{!busy && <ArrowIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

function LaunchControl({ option, persona, busy, disabled, onLaunch }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-2.5 h-11 px-3.5 rounded-[10px] border max-w-[460px]"
        style={{ borderColor: 'var(--auth-card-border-strong)', background: 'var(--auth-card-bg)' }}>
        <span className="text-[11px] uppercase tracking-[.12em] font-bold shrink-0" style={{ color: 'var(--auth-faint)' }}>Viewing as</span>
        <span className="text-[14px] font-bold truncate" style={{ color: 'var(--auth-text)' }}>{selectedLabel(option, persona)}</span>
        {option && <span className="text-[12px] pl-2.5 border-l shrink-0" style={{ color: 'var(--auth-muted)', borderColor: 'var(--auth-card-border)' }}>{option.group}</span>}
      </div>
      <button type="button" disabled={disabled} onClick={onLaunch}
        className="h-11 px-[18px] rounded-[10px] text-[14px] font-bold inline-flex items-center gap-2 shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}>
        {busy ? 'Opening…' : 'Open preview'}{!busy && <ArrowIcon className="size-[15px]" />}
      </button>
    </div>
  );
}

function usePinnedBar(rootRef, launchRef) {
  const [state, setState] = useState({ visible: false, left: 0, width: 0 });
  useEffect(() => {
    const root = rootRef.current; const target = launchRef.current;
    if (!root || !target) return undefined;
    let visible = false;
    const measure = () => {
      const box = root.getBoundingClientRect();
      setState({ visible, left: box.left, width: box.width });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      measure();
    });
    observer.observe(target);
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); resize.disconnect(); window.removeEventListener('resize', measure); };
  }, [rootRef, launchRef]);
  return state;
}

function LaunchNote() {
  const items = ['New tab', 'Synthetic data', 'Expires in 30 min', 'Owner session not shared'];
  return (
    <p className="flex flex-wrap items-center justify-end gap-x-1.5 text-[12px]" style={{ color: 'var(--auth-muted)' }}>
      {items.map((item, i) => (
        <span key={item} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="size-[3px] rounded-full" style={{ background: 'var(--auth-faint)' }} />}
          {item}
        </span>
      ))}
    </p>
  );
}

function ViewRow({ option, first, selected, onSelect, onLaunch, disabled }) {
  const active = option.scenarios.some((p) => p.id === selected);
  const current = option.scenarios.find((p) => p.id === selected) || option.scenarios[0];
  const multi = option.scenarios.length > 1;
  const inputId = `vp-${option.id}`;
  const stop = (event) => event.stopPropagation();
  return (
    // The whole row is a click target for mouse users; the radio input is the
    // accessible control (arrow keys move through the group natively).
    <div onClick={() => { if (!active) onSelect(option.scenarios[0].id); }}
      className={`group relative grid grid-cols-[16px_minmax(0,1fr)_auto] sm:grid-cols-[16px_210px_minmax(0,1fr)_auto] items-start sm:items-center gap-x-3.5 gap-y-1 pl-4 pr-3.5 py-2.5 min-h-[52px] cursor-pointer transition-colors hover:bg-[var(--auth-hover-bg)] ${first ? '' : 'border-t'}`}
      style={{ borderColor: 'var(--auth-row-border)', ...(active ? { background: 'color-mix(in srgb, var(--auth-accent) 11%, transparent)' } : null) }}>
      {active && <span aria-hidden="true" className="absolute left-0 inset-y-0 w-[3px]" style={{ background: 'var(--auth-accent)' }} />}
      <span className="relative mt-[2px] sm:mt-0 size-4">
        <input id={inputId} className="peer sr-only" type="radio" name="persona" value={option.id} checked={active}
          onChange={() => onSelect(option.scenarios[0].id)} />
        <span aria-hidden="true" className="block size-4 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
          style={{ border: active ? '5px solid var(--auth-accent-strong)' : '1.5px solid var(--auth-muted)', outlineColor: 'var(--auth-accent)' }} />
      </span>
      <label htmlFor={inputId} className="text-[14px] font-semibold cursor-pointer" style={{ color: 'var(--auth-text)' }}>{option.label}</label>
      <div className="col-start-2 sm:col-start-3 row-start-2 sm:row-start-1 min-w-0 flex flex-col gap-1.5">
        <span className={`text-[13px] leading-[19px] ${active ? '' : 'sm:truncate'}`} style={{ color: 'var(--auth-muted)' }}
          title={active ? undefined : option.description}>
          {option.description}
        </span>
        {active && multi && <ScenarioToggle option={option} selected={selected} onSelect={onSelect} />}
      </div>
      <div className="col-start-3 sm:col-start-4 row-start-1 self-center flex items-center justify-end" onClick={stop}>
        <span className={`font-mono text-[11.5px] ${active ? 'hidden' : 'hidden sm:inline sm:group-hover:hidden sm:group-focus-within:hidden'}`}
          style={{ color: 'var(--auth-muted)' }}>{option.scenarios[0].path}</span>
        <button type="button" disabled={disabled} onClick={() => onLaunch(current.id)}
          aria-label={`Open preview as ${selectedLabel(option, current)}`}
          className={`${active ? 'inline-flex' : 'hidden sm:group-hover:inline-flex sm:group-focus-within:inline-flex'} h-7 px-2.5 rounded-[7px] border items-center gap-1.5 text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed`}
          style={{ borderColor: 'var(--auth-card-border-strong)', background: 'var(--auth-card-bg)', color: 'var(--auth-text)' }}>
          Open<ArrowIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

function ScenarioToggle({ option, selected, onSelect }) {
  return (
    <div role="group" aria-label={`${option.label} test scenario`} onClick={(event) => event.stopPropagation()}
      className="inline-flex w-max max-w-full rounded-lg border p-0.5"
      style={{ borderColor: 'var(--auth-card-border-strong)', background: 'var(--auth-card-bg-alt)' }}>
      {option.scenarios.map((scenario) => {
        const on = scenario.id === selected;
        return (
          <button key={scenario.id} type="button" aria-pressed={on} onClick={() => onSelect(scenario.id)}
            className="h-7 px-3 rounded-md text-[12.5px] font-semibold whitespace-nowrap transition-colors"
            style={{ background: on ? 'var(--auth-card-bg)' : 'transparent', color: on ? 'var(--auth-text)' : 'var(--auth-muted)', boxShadow: on ? '0 0 0 1px var(--auth-card-border-strong)' : 'none' }}>
            {scenario.scenario || scenario.label}
          </button>
        );
      })}
    </div>
  );
}
