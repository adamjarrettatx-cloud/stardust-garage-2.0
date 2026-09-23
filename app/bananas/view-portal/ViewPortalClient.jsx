'use client';
import { useMemo, useState } from 'react';
import { viewOptions, VIEW_GROUP_DESCRIPTIONS } from '@/lib/view-portal/personas';

export default function ViewPortalClient({ personas, ready, statusMessage }) {
  const [selected, setSelected] = useState(personas[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = useMemo(() => viewOptions(personas), [personas]);
  const groups = useMemo(() => Array.from(new Set(options.map((p) => p.group))), [options]);
  const chosen = personas.find((persona) => persona.id === selected);
  async function launch() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/view-portal/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: selected }),
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
  return (
    <div className="space-y-8">
      {!ready && (
        <div role="status" className="border border-amber-500/50 bg-amber-500/10 rounded-xl p-5">
          <div className="text-[12px] uppercase tracking-[.14em] font-extrabold text-amber-300">Launch locked</div>
          <p className="mt-2 text-[15px] leading-6" style={{ color: 'var(--auth-text)' }}>{statusMessage}</p>
        </div>
      )}
      <div className="grid xl:grid-cols-[1fr_320px] gap-8 items-start">
        <div className="space-y-8 order-last xl:order-first">
          {groups.map((group) => (
            <fieldset key={group}>
              <legend className="text-[12px] uppercase tracking-[.14em] font-extrabold mb-3" style={{ color: 'var(--auth-muted)' }}>{group}</legend>
              {VIEW_GROUP_DESCRIPTIONS[group] && <p className="mb-4 text-[13px] leading-6" style={{ color: 'var(--auth-muted)' }}>{VIEW_GROUP_DESCRIPTIONS[group]}</p>}
              <div className="grid md:grid-cols-2 gap-3">
                {options.filter((p) => p.group === group).map((option) => {
                  const active = option.scenarios.some((p) => p.id === selected);
                  return (
                    <div key={option.id} className="rounded-xl border p-4 min-h-[112px] transition-colors focus-within:ring-2"
                      style={{ borderColor: active ? 'var(--auth-accent)' : 'var(--auth-border)', background: active ? 'var(--auth-card-bg)' : 'transparent' }}>
                      <label className="block cursor-pointer">
                      <input className="sr-only" type="radio" name="persona" value={option.id}
                        checked={active} onChange={() => setSelected(option.scenarios[0].id)} />
                      <span className="flex justify-between gap-4">
                        <span>
                          <span className="block text-[16px] font-bold" style={{ color: 'var(--auth-text)' }}>{option.label}</span>
                          <span className="block mt-2 text-[13px] leading-5" style={{ color: 'var(--auth-muted)' }}>{option.description}</span>
                        </span>
                        <span aria-hidden="true" className="mt-1 size-4 rounded-full border-2 shrink-0"
                          style={{ borderColor: active ? 'var(--auth-accent)' : 'var(--auth-muted)', boxShadow: active ? 'inset 0 0 0 3px var(--auth-card-bg)' : 'none', background: active ? 'var(--auth-accent)' : 'transparent' }} />
                      </span>
                      </label>
                      {active && option.scenarios.length > 1 && <label className="mt-4 block text-[13px]" style={{ color: 'var(--auth-text)' }}>
                        Test scenario
                        <select aria-label={`${option.label} test scenario`} value={selected} onChange={(event) => setSelected(event.target.value)}
                          className="mt-2 block w-full min-h-11 rounded-lg border px-3" style={{ borderColor: 'var(--auth-border)', background: 'var(--auth-card-bg)', color: 'var(--auth-text)' }}>
                          {option.scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.scenario || scenario.label}</option>)}
                        </select>
                      </label>}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <aside className="order-first xl:order-last xl:sticky xl:top-6 rounded-xl border p-5" style={{ borderColor: 'var(--auth-border)', background: 'var(--auth-card-bg)' }}>
          <div className="text-[12px] uppercase tracking-[.14em] font-extrabold" style={{ color: 'var(--auth-muted)' }}>Selected view</div>
          <h2 className="mt-2 text-[20px] font-bold" style={{ color: 'var(--auth-text)' }}>{chosen?.label}</h2>
          <p className="mt-3 text-[14px] leading-6" style={{ color: 'var(--auth-muted)' }}>{chosen?.description}</p>
          <button type="button" disabled={!ready || busy} onClick={launch}
            className="mt-6 min-h-12 w-full rounded-lg px-5 text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}>
            {busy ? 'Opening…' : 'Open isolated preview'}
          </button>
          <p className="mt-4 text-[12px] leading-5" style={{ color: 'var(--auth-muted)' }}>
            Opens in a separate tab. The preview uses synthetic data, expires after 30 minutes and cannot access your owner session.
          </p>
          {error && <p role="alert" className="mt-4 text-[13px] text-red-400">{error}</p>}
        </aside>
      </div>
    </div>
  );
}
