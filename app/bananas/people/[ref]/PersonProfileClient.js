'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { phoneHref } from '@/lib/phone';
import styles from './person-profile.module.css';

// Person Profile (approved preview, Oct 2026). Rectangular controls on the
// framed admin palette. Send message and Gift ticket are placeholders for
// later phases and stay disabled.

const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const money2 = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => (v ? new Date(v).toLocaleDateString('en-US', { ...opts, timeZone: 'America/Chicago' }) : '—');
const fmtDay = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const trialWord = (state) => { const w = String(state || '').replace('TRIAL · ', '').toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); };
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function toneClass(tone) {
  return { member: styles.bOk, ok: styles.bOk, trial: styles.bWarn, warn: styles.bWarn, bad: styles.bBad, info: styles.bInfo }[tone] || styles.bN;
}

function monthsSince(iso) {
  if (!iso) return 0;
  const a = new Date(iso); const b = new Date();
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0));
}

function Copy({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={styles.mini} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch {}
    }}>{done ? 'Copied' : 'Copy'}</button>
  );
}

async function api(url, method, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

function Tags({ refKey, initial }) {
  const [tags, setTags] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!value.trim()) { setAdding(false); return; }
    setBusy(true); setError('');
    try {
      const { tag } = await api(`/api/admin/people/${refKey}/tags`, 'POST', { label: value });
      setTags((t) => (t.some((x) => x.id === tag.id) ? t : [...t, tag]));
      setValue(''); setAdding(false);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async (tag) => {
    if (!window.confirm(`Remove the tag "${tag.label}"?`)) return;
    setError('');
    try {
      await api(`/api/admin/people/${refKey}/tags/${tag.id}`, 'DELETE');
      setTags((t) => t.filter((x) => x.id !== tag.id));
    } catch (err) { setError(err.message); }
  };
  return (
    <div className={styles.tags}>
      {tags.map((t) => (
        <span key={t.id} className={styles.tag} title={t.created_by_name ? `Added by ${t.created_by_name}` : undefined}>
          {t.label}
          <button type="button" aria-label={`Remove ${t.label}`} className={styles.tagX} onClick={() => remove(t)}>×</button>
        </span>
      ))}
      {adding ? (
        <form onSubmit={add} className={styles.tagForm}>
          <input autoFocus maxLength={32} value={value} onChange={(e) => setValue(e.target.value)} placeholder="VIP, Regular…" onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setValue(''); } }} />
          <button type="submit" className={styles.mini} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
          <button type="button" className={styles.mini} onClick={() => { setAdding(false); setValue(''); }}>Cancel</button>
        </form>
      ) : (
        <button type="button" className={`${styles.tag} ${styles.tagAdd}`} onClick={() => setAdding(true)}>+ Add tag</button>
      )}
      {error ? <span className={styles.err}>{error}</span> : null}
    </div>
  );
}

function Notes({ refKey, initial, firstName, inputRef }) {
  const [notes, setNotes] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true); setError('');
    try {
      const { note } = await api(`/api/admin/people/${refKey}/notes`, 'POST', { body: draft });
      setNotes((n) => [note, ...n]); setDraft('');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const saveEdit = async (id) => {
    setError('');
    try {
      const { note } = await api(`/api/admin/people/${refKey}/notes/${id}`, 'PATCH', { body: editText });
      setNotes((n) => n.map((x) => (x.id === id ? note : x))); setEditing(null);
    } catch (err) { setError(err.message); }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this note?')) return;
    setError('');
    try {
      await api(`/api/admin/people/${refKey}/notes/${id}`, 'DELETE');
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch (err) { setError(err.message); }
  };
  return (
    <section className={styles.card} id="notes">
      <h2 className={styles.h2}>STAFF NOTES <span className={styles.sub}>Team only</span></h2>
      <textarea ref={inputRef} className={styles.textarea} value={draft} maxLength={5000} onChange={(e) => setDraft(e.target.value)} placeholder={`Add a note about ${firstName}…`} />
      <div className={styles.noteBar}>
        {error ? <span className={styles.err}>{error}</span> : <span />}
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy || !draft.trim()} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>
      </div>
      {notes.length === 0 ? <p className={styles.small}>No notes yet.</p> : null}
      {notes.map((n) => (
        <div key={n.id} className={styles.note}>
          {editing === n.id ? (
            <>
              <textarea className={styles.textarea} value={editText} maxLength={5000} onChange={(e) => setEditText(e.target.value)} />
              <div className={styles.noteActions}>
                <button type="button" className={styles.mini} onClick={() => saveEdit(n.id)}>Save</button>
                <button type="button" className={styles.mini} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.noteBody}>{n.body}</div>
              <div className={styles.by}>
                {n.author_name} · {fmtDate(n.created_at)}{n.edited_at ? ' · edited' : ''}
                {n.can_edit ? <button type="button" className={styles.linkBtn} onClick={() => { setEditing(n.id); setEditText(n.body); }}>Edit</button> : null}
                {n.can_delete ? <button type="button" className={styles.linkBtn} onClick={() => remove(n.id)}>Delete</button> : null}
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

export default function PersonProfileClient({ profile }) {
  const router = useRouter();
  const noteRef = useRef(null);
  const flagsRef = useRef(null);
  const { person, stats, spend, flags, membership, permissions } = profile;
  const [tab, setTab] = useState('all');
  const [allVisits, setAllVisits] = useState(false);
  const [allPurchases, setAllPurchases] = useState(false);
  const firstName = String(person.full_name || '').split(/\s+/)[0] || 'this person';

  const visitList = useMemo(() => profile.visits.filter((v) => tab === 'all' || (tab === 'events' ? v.kind === 'event' : v.kind !== 'event')), [profile.visits, tab]);
  const shownVisits = allVisits ? visitList : visitList.slice(0, 5);
  const shownPurchases = allPurchases ? profile.purchases : profile.purchases.slice(0, 5);
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count));
  const m = membership.member;
  const spendParts = [
    `Tickets ${money(spend.tickets)}`,
    spend.studio ? `Studio ${money(spend.studio)}` : null,
    spend.duesAvailable ? (spend.dues || m ? `Dues ${money(spend.dues)}` : null) : 'Dues unavailable',
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.root}>
      <button type="button" className={styles.back} onClick={() => router.back()}>← BACK</button>

      <section className={styles.card}>
        <div className={styles.hero}>
          <div className={styles.avatar}>
            {/* Signed private-bucket URL; next/image would proxy and cache it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {person.photo_url ? <img src={person.photo_url} alt="" /> : initials(person.full_name)}
          </div>
          <div className={styles.heroMain}>
            <div className={styles.badges}>
              {person.badges.map((b) => <span key={b.label} className={`${styles.badge} ${toneClass(b.tone)}`}>{b.label}</span>)}
              {person.top_badge ? <span className={`${styles.badge} ${styles.bInfo}`}>{person.top_badge}</span> : null}
            </div>
            <h1 className={styles.name}>{person.full_name}</h1>
            <div className={styles.meta}>
              {person.email ? <span><a href={`mailto:${person.email}`}>{person.email}</a><Copy value={person.email} /></span> : <span>No email</span>}
              {person.phone ? <span><a href={phoneHref(person.phone)}>{person.phone_display || person.phone}</a><Copy value={person.phone_display || person.phone} /><a className={styles.mini} href={phoneHref(person.phone)}>Call</a></span> : <span>No phone</span>}
              <span>First seen {fmtDate(person.first_seen)}</span>
            </div>
            <Tags refKey={profile.ref} initial={person.tags} />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => { noteRef.current?.focus(); noteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Add note</button>
            <button type="button" className={styles.btn} disabled title="Coming in a later phase">Send message</button>
            <button type="button" className={styles.btn} disabled title="Coming in a later phase">Gift ticket</button>
          </div>
        </div>
        {flags.count > 0 ? (
          <div className={`${styles.flagbar} ${flags.activeRestrictions ? styles.flagBad : ''}`}>
            <span className={`${styles.badge} ${flags.activeRestrictions ? styles.bBad : styles.bWarn}`}>{flags.count} FLAG{flags.count === 1 ? '' : 'S'}</span>
            <span className={styles.flagText}>
              {flags.summary ? <><b>{flags.summary.action}</b> · {flags.summary.category} · {fmtDate(flags.summary.at)}{flags.summary.event ? ` at ${flags.summary.event}` : ''}. </> : null}
              {flags.activeRestrictions ? `${flags.activeRestrictions} active restriction${flags.activeRestrictions === 1 ? '' : 's'}.` : 'No active restrictions.'}
            </span>
            <button type="button" className={styles.flagView} onClick={() => flagsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>View ↓</button>
          </div>
        ) : null}
      </section>

      <div className={styles.stats}>
        <div className={styles.stat}><div className={styles.l}>LIFETIME SPEND</div><div className={styles.v}>{money(spend.total)}</div><div className={styles.s}>{spendParts}</div></div>
        <div className={styles.stat}><div className={styles.l}>TOTAL VISITS</div><div className={styles.v}>{stats.total}</div><div className={styles.s}>{stats.events} event{stats.events === 1 ? '' : 's'} · {stats.frontDesk} other</div></div>
        <div className={styles.stat}><div className={styles.l}>VISITS / MONTH</div><div className={styles.v}>{stats.perMonth90}</div><div className={styles.s}>Last 90 days · avg {stats.perMonthAll} all time</div></div>
        {m ? (
          <div className={styles.stat}><div className={styles.l}>MEMBER FOR</div><div className={styles.v}>{monthsSince(m.since) < 1 ? '<1 mo' : `${monthsSince(m.since)} mo`}</div><div className={styles.s}>Since {fmtDate(m.since)}{m.active && m.renews ? ` · ${m.cancelling ? 'ends' : 'renews'} ${fmtDate(m.renews, { month: 'short', day: 'numeric' })}` : m.active ? '' : ' · ended'}</div></div>
        ) : (
          <div className={styles.stat}><div className={styles.l}>MEMBERSHIP</div><div className={styles.v}>{membership.trial ? 'Trial' : 'None'}</div><div className={styles.s}>{membership.trial ? `${trialWord(membership.trial.state)} · issued ${fmtDate(membership.trial.issued_at, { month: 'short', day: 'numeric' })}` : 'Not a member'}</div></div>
        )}
        <div className={styles.stat}><div className={styles.l}>LAST VISIT</div><div className={styles.v}>{stats.last ? (stats.last.daysAgo <= 0 ? 'Tonight' : `${stats.last.daysAgo} day${stats.last.daysAgo === 1 ? '' : 's'}`) : '—'}</div><div className={styles.s}>{stats.last ? `${fmtDay(stats.last.day)} · ${stats.last.title}` : 'No visits recorded'}</div></div>
        <div className={styles.stat}><div className={styles.l}>GUESTS BROUGHT</div><div className={styles.v}>{stats.guestsBrought}</div><div className={styles.s}>Extra tickets on their orders</div></div>
      </div>

      <div className={styles.grid}>
        <div className={styles.col}>
          <section className={styles.card}>
            <h2 className={styles.h2}>VISITS BY MONTH <span className={styles.sub}>{stats.months[0]?.label} – {stats.months[stats.months.length - 1]?.label}</span></h2>
            <div className={styles.chart}>
              {stats.months.map((mo) => (
                <div key={mo.key} className={`${styles.bar} ${mo.current ? styles.barHi : ''}`}>
                  <em>{mo.count}</em>
                  <i style={{ height: `${Math.max(mo.count ? 6 : 2, (mo.count / maxMonth) * 100)}%` }} />
                  <span>{mo.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>
              EVENTS ATTENDED
              <span className={styles.tabs} role="tablist">
                {[['all', `All ${stats.total}`], ['events', `Events ${stats.events}`], ['other', `Front desk ${stats.frontDesk}`]].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? styles.tabOn : ''} onClick={() => { setTab(k); setAllVisits(false); }}>{label}</button>
                ))}
              </span>
            </h2>
            {shownVisits.length === 0 ? <p className={styles.small}>No visits recorded.</p> : null}
            {shownVisits.map((v, i) => (
              <div key={`${v.day}-${v.event_id}-${i}`} className={styles.row}>
                <div className={styles.date}>{v.day_label}</div>
                <div className={styles.grow}>
                  <div className={styles.t1}>{v.title}</div>
                  <div className={styles.t2}>{[v.category_label, v.how].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={`${styles.badge} ${styles.bN} ${styles.methodBadge}`}>{v.method}</span>
              </div>
            ))}
            {visitList.length > 5 ? <div className={styles.more}><button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setAllVisits((x) => !x)}>{allVisits ? 'Show fewer' : `Show all ${visitList.length}`}</button></div> : null}
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>PURCHASES <span className={styles.sub}>{money2(spend.total)} net{spend.refunded ? ` · ${money2(spend.refunded)} refunded` : ''}</span></h2>
            {shownPurchases.length === 0 ? <p className={styles.small}>No purchases recorded.</p> : null}
            {shownPurchases.map((p, i) => (
              <div key={`${p.at}-${i}`} className={styles.row}>
                <div className={styles.date}>{fmtDate(p.at, { month: 'short', day: 'numeric' })}</div>
                <div className={styles.grow}><div className={styles.t1}>{p.title}</div><div className={styles.t2}>{p.sub}</div></div>
                <div className={`${styles.amt} ${p.refunded ? styles.amtStruck : ''}`}>{money2(p.cents)}</div>
              </div>
            ))}
            {profile.purchases.length > 5 ? <div className={styles.more}><button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setAllPurchases((x) => !x)}>{allPurchases ? 'Show fewer' : `Show all ${profile.purchases.length}`}</button></div> : null}
            <p className={styles.small}>
              Bar purchases aren&apos;t included. SpotOn sales aren&apos;t linked to a customer.
              {profile.meta.hasTicketTailor ? ' Older Ticket Tailor tickets count as visits for events that have happened, but their prices weren\u2019t imported.' : ''}
              {!profile.meta.duesAvailable ? ' Membership dues couldn\u2019t be loaded from Stripe right now.' : ''}
            </p>
          </section>
        </div>

        <div className={styles.col}>
          <Notes refKey={profile.ref} initial={profile.notes} firstName={firstName} inputRef={noteRef} />

          <section className={styles.card}>
            <h2 className={styles.h2}>INTERESTS</h2>
            {profile.interests.length === 0 ? <p className={styles.small}>No event categories yet.</p> : (
              <div className={styles.cats}>
                {profile.interests.map((c) => (
                  <div key={c.category} className={styles.cat}>
                    <span className={styles.dot} style={{ background: c.color }} />
                    <span className={styles.catLabel}>{c.label}</span>
                    <span className={styles.track}><i style={{ width: `${c.pct}%`, background: c.color }} /></span>
                    <span className={styles.catN}>{c.count}</span>
                  </div>
                ))}
              </div>
            )}
            <p className={styles.small}>
              Based on event categories attended.
              {profile.quiz?.selected ? ` Membership quiz: picked ${profile.quiz.selected}.` : profile.quiz?.recommended?.length ? ` Membership quiz: recommended ${profile.quiz.recommended.join(', ')}.` : ''}
            </p>
          </section>

          <section className={styles.card} ref={flagsRef}>
            <h2 className={styles.h2}>FLAGS &amp; INCIDENTS <span className={styles.sub}>{flags.count} total</span></h2>
            {flags.items.length === 0 ? <p className={styles.small}>No incidents or restrictions.</p> : null}
            {flags.items.map((f) => (
              <div key={f.id} className={styles.row}>
                <div className={styles.grow}>
                  <div className={styles.t1}>{f.title}</div>
                  {f.note ? <div className={styles.t2}>{f.note}</div> : null}
                  <div className={styles.t2}>{[f.by, fmtDate(f.at)].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={`${styles.badge} ${toneClass(f.tone)}`}>{f.badge}</span>
              </div>
            ))}
            <p className={styles.small}>Bans and restrictions show here read-only. Lifting or removing them stays in <Link href="/bananas/security">Security</Link>.</p>
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>MEMBERSHIP</h2>
            <div className={styles.kv}>
              <div><div className={styles.l}>PLAN</div>{m ? `${m.plan} · ${m.period}` : 'Not a member'}</div>
              <div><div className={styles.l}>STATUS</div>{m ? <span className={`${styles.badge} ${m.active ? (m.cancelling ? styles.bWarn : styles.bOk) : styles.bN}`}>{m.active ? (m.cancelling ? 'CANCELLING' : String(m.status).toUpperCase().replace('_', ' ')) : 'ENDED'}</span> : '—'}</div>
              <div><div className={styles.l}>MEMBER SINCE</div>{m ? fmtDate(m.since) : '—'}</div>
              <div><div className={styles.l}>{m?.cancelling ? 'ENDS' : 'RENEWS'}</div>{m?.active && m.renews ? fmtDate(m.renews) : '—'}</div>
              <div><div className={styles.l}>TRIAL PASS</div>{membership.trial ? (membership.trial.converted_at ? `${fmtDate(membership.trial.issued_at, { month: 'short', day: 'numeric' })} → converted ${fmtDate(membership.trial.converted_at, { month: 'short', day: 'numeric' })}` : `${trialWord(membership.trial.state)} · issued ${fmtDate(membership.trial.issued_at, { month: 'short', day: 'numeric' })}`) : 'None'}</div>
              <div><div className={styles.l}>APPLICATION</div>{membership.application ? <Link className={styles.mini} href={`/bananas/applications/${membership.application.id}`}>View answers</Link> : 'None'}</div>
            </div>
            {m ? <p className={styles.small}><Link href={`/bananas/members/${m.id}`}>Open member record</Link> for subscription actions.</p> : null}
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>CONTACT PERMISSIONS</h2>
            {[['Marketing email', permissions.email], ['App push notifications', permissions.push], ['Text messages', permissions.sms]].map(([label, p]) => (
              <div key={label} className={styles.perm}>
                <span>{label}{p.note ? <span className={styles.permNote}>{p.note}</span> : null}</span>
                <span className={`${styles.badge} ${toneClass(p.tone)}`}>{p.label}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
