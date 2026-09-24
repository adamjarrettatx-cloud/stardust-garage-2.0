'use client';
import { useState } from 'react';
import W9Form from './W9Form';
import styles from './w9.module.css';
const labels={pending:'Pending review',approved:'Approved',denied:'Changes required'};
export default function ArtistW9({initialSubmissions=[]}){
  const [submissions,setSubmissions]=useState(initialSubmissions),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const latest=submissions[0],approved=submissions.some(s=>s.status==='approved'),current=approved?submissions.find(s=>s.status==='approved'):latest;
  async function start(){
    setBusy(true);setError('');
    try{const r=await fetch('/api/portal/w9/open',{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error);setOpen(true)}
    catch(e){setError(e.message||'Could not open W-9.')}finally{setBusy(false)}
  }
  async function refresh(){
    setOpen(false);setError('');
    try{const r=await fetch('/api/portal/w9',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);setSubmissions(d.submissions||[])}
    catch(e){setError(e.message||'Submitted. Refresh the page to see your current status.')}
  }
  return <section id="w9" className={styles.panel}>
    <div className={styles.heading}><h2>Your W-9</h2><span className={styles.badge}>{labels[current?.status]||'Not submitted'}</span></div>
    <p className={styles.status}>{approved?'Ready to book':'Booking locked until your W-9 is approved.'}</p>
    {latest?.status==='denied'&&!open&&<div className={styles.notice}><strong>Please submit a new W-9</strong><p>{latest.rejection_reason}</p><p className={styles.note}>Your previous signed submission stays unchanged. Complete and sign a new form for review.</p></div>}
    {latest?.status==='pending'&&<><p>Your W-9 has been submitted for review. We will notify you when it is approved or if changes are needed.</p><button className={styles.button} onClick={refresh}>Refresh status</button></>}
    {approved&&<p>Your approved W-9 is retained privately and linked to your artist profile. Booking can now begin; payment requests become available after an eligible performance.</p>}
    {!open&&!['pending','approved'].includes(latest?.status)&&<><p className={styles.note}>Complete your W-9 before Stardust Garage can book you for an event.</p><button className={styles.primary} onClick={start} disabled={busy}>{busy?'Opening…':'Fill out w9'}</button></>}
    {open&&<W9Form onSubmitted={refresh} onCancel={()=>setOpen(false)}/>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {!!submissions.length&&!open&&<div className={styles.history}><h3>Submission history</h3>{submissions.map(s=><article key={s.id}><strong>{labels[s.status]}</strong> · {new Date(s.created_at).toLocaleDateString('en-US')}
      {s.rejection_reason&&<p>{s.rejection_reason}</p>}<a href={`/api/portal/w9/${s.id}/document`} target="_blank" rel="noreferrer">View signed W-9</a></article>)}</div>}
  </section>;
}
