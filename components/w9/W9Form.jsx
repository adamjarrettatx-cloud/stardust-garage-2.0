'use client';
import { useState } from 'react';
import { W9_CLASSIFICATIONS,W9_CERTIFICATIONS,W9_CONSENT_VERSION,W9_SIGNING_NOTICE,validateW9 } from '@/lib/w9/form';
import styles from './w9.module.css';
const EMPTY={legalName:'',businessName:'',classification:'',llcClassification:'',otherClassification:'',address:'',cityStateZip:'',
  exemptPayee:'',fatca:'',requester:'',accountNumbers:'',tinType:'ssn',tin:'',foreignOwners:false,backupWithholding:false,usPerson:true,certified:false,signature:''};
export default function W9Form({onSubmitted,onCancel}){
  const [values,setValues]=useState(()=>({...EMPTY,id:crypto.randomUUID(),consentVersion:W9_CONSENT_VERSION}));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const change=(key,value)=>setValues(v=>({...v,[key]:value}));
  const field=(key,label,max,required=false)=> <label className={styles.field} key={key}>{label}{required?' *':''}
    <input name={key} value={values[key]} maxLength={max} required={required} disabled={busy} autoComplete="off" onChange={e=>change(key,e.target.value)}/></label>;
  async function submit(e){
    e.preventDefault();setError('');
    const result=validateW9(values);if(!result.ok){setError(result.error);return}
    setBusy(true);
    try{
      const r=await fetch('/api/portal/w9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Submission failed.');
      // Clear sensitive inputs immediately; never store a local draft.
      setValues({...EMPTY,id:crypto.randomUUID(),consentVersion:W9_CONSENT_VERSION});
      onSubmitted();
    }catch(failure){setError(failure.message||'Could not submit. Please try again.')}
    finally{setBusy(false)}
  }
  return <form onSubmit={submit} className={styles.form} autoComplete="off">
    <div className={styles.formTitle}><strong>W-9</strong><div><h3>Request for Taxpayer Identification Number and Certification</h3><p>IRS Form W-9 · March 2024</p></div></div>
    <p className={styles.note}>Complete all applicable required fields. We will place your entries on the standard IRS form and retain the signed PDF privately. <a href="/api/portal/w9/blank" target="_blank" rel="noreferrer">View the official form and instructions</a>.</p>
    <label className={styles.check}><input type="checkbox" checked={values.usPerson} disabled={busy} onChange={e=>change('usPerson',e.target.checked)}/>I am a U.S. citizen or other U.S. person for federal tax purposes.</label>
    {!values.usPerson&&<p className={styles.error}>Do not submit a W-9 if you are a foreign person. Contact Stardust Garage for the appropriate tax documentation.</p>}
    {field('legalName','1 · Name of entity/individual',120,true)}
    <p className={styles.note}>Use the name on your tax return. Sole proprietors and disregarded entities enter the owner’s name on line 1.</p>
    {field('businessName','2 · Business/disregarded entity name, if different',120)}
    <label className={styles.field}>3a · Federal tax classification *
      <select required value={values.classification} disabled={busy} onChange={e=>setValues(v=>({...v,classification:e.target.value,foreignOwners:false,llcClassification:'',otherClassification:''}))}>
        <option value="">Select one</option>{W9_CLASSIFICATIONS.map(([value,label])=><option value={value} key={value}>{label}</option>)}
      </select></label>
    {values.classification==='llc'&&<label className={styles.field}>LLC tax classification *
      <select required disabled={busy} value={values.llcClassification} onChange={e=>setValues(v=>({...v,llcClassification:e.target.value,foreignOwners:false}))}>
        <option value="">Select one</option><option value="C">C corporation</option><option value="S">S corporation</option><option value="P">Partnership</option>
      </select></label>}
    <p className={styles.note}>A disregarded entity uses its owner’s tax classification, not the LLC box.</p>
    {values.classification==='other'&&field('otherClassification','Other classification',80,true)}
    <label className={styles.check}><input type="checkbox" checked={values.foreignOwners}
      disabled={busy||(!['partnership','trust_estate'].includes(values.classification)&&!(values.classification==='llc'&&values.llcClassification==='P'))}
      onChange={e=>change('foreignOwners',e.target.checked)}/>3b · I have foreign partners, owners, or beneficiaries and am providing this form to a partnership, trust, or estate in which I have an ownership interest. See instructions.</label>
    <div className={styles.fields}>{field('exemptPayee','4 · Exempt payee code, if any',2)}{field('fatca','FATCA exemption code, if any',1)}</div>
    <p className={styles.note}>Exemption codes apply only to certain entities, not individuals. FATCA codes apply to accounts maintained outside the United States.</p>
    {field('address','5 · Mailing address (street and unit)',160,true)}
    {field('cityStateZip','6 · City, state, and ZIP code',120,true)}
    {field('requester','Requester’s name and address (optional)',160)}
    {field('accountNumbers','7 · Account numbers (optional)',80)}
    <h3>Part I · Taxpayer Identification Number</h3>
    <div className={styles.fields}><label className={styles.field}>Number type *<select disabled={busy} value={values.tinType} onChange={e=>change('tinType',e.target.value)}><option value="ssn">Social Security number</option><option value="ein">Employer identification number</option><option value="itin">Individual taxpayer identification number</option></select></label>
    <label className={styles.field}>Taxpayer identification number *<input name="taxpayer-number" type="password" inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" required maxLength={11} value={values.tin} disabled={busy} onChange={e=>change('tin',e.target.value)}/></label></div>
    <p className={styles.note}>Your TIN must match the name on line 1. If you are waiting for a TIN, contact Stardust Garage before submitting. A complete TIN is required for this booking workflow.</p>
    <h3>Part II · Certification</h3>
    <p>Under penalties of perjury, I certify that:</p>
    <ol className={styles.certifications}>{W9_CERTIFICATIONS.map((text,i)=><li key={text} style={i===1&&values.backupWithholding?{textDecoration:'line-through'}:undefined}>{text}</li>)}</ol>
    <label className={styles.check}><input type="checkbox" checked={values.backupWithholding} disabled={busy} onChange={e=>change('backupWithholding',e.target.checked)}/>The IRS has notified me that I am currently subject to backup withholding because I failed to report all interest and dividends. Cross out certification item 2.</label>
    <p className={styles.note}>Certification instructions: You must cross out item 2 if the IRS has notified you that you are currently subject to backup withholding for failure to report all interest and dividends. For real estate transactions, item 2 does not apply. For mortgage interest, acquisition or abandonment of secured property, cancellation of debt, IRA contributions, and generally payments other than interest and dividends, the IRS does not require a signature, but you must provide your correct TIN. Stardust Garage requests a signed W-9 for this workflow. See Part II instructions in the official form.</p>
    <label className={styles.check}><input type="checkbox" required checked={values.certified} disabled={busy} onChange={e=>change('certified',e.target.checked)}/>{W9_SIGNING_NOTICE}</label>
    <p className={styles.note}>Your electronic signature authenticates this submission under penalties of perjury. The signing date and time are recorded automatically when submitted.</p>
    {field('signature','Electronic signature: type your full name',100,true)}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy||!values.usPerson}>{busy?'Submitting…':'Submit'}</button><button type="button" className={styles.button} disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
