'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CONTACT_TYPE_OPTIONS, CONTACT_STATUS_OPTIONS, isContactTypeSelected, toggleContactType, contactDirectoryHref } from '@/lib/contact-helpers';
import { ENTITY_TYPE_OPTIONS } from '@/lib/event-organizer';
import styles from './profile.module.css';
import OrganizationMainContact from './OrganizationMainContact';
import { contactProfileKind } from '@/lib/contact-organizations';

function ProfilePhoto({ url, name }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  // Contact photos retain the existing image-URL model; no public upload bucket
  // or storage permissions are introduced by this layout-only change.
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setFailed(true)} />;
  }
  return <span className={styles.initials}>{initials}</span>;
}

export default function ContactProfileLayout({
  contact, initialCategory, profile, values, setField, dirty, saving,
  error, success, onDiscard, onSubmit, showLegalFields, onArchive,
}) {
  const formId = useId();
  const organization = values.profile_kind === 'organization';
  const [section, setSection] = useState(profile.initialTab || 'overview');
  useEffect(() => { if (profile.initialTab) setSection(profile.initialTab); }, [profile.initialTab]);
  const [photoDraft, setPhotoDraft] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [typeDraft, setTypeDraft] = useState([]);
  const [typeError, setTypeError] = useState('');
  const photoDialog = useRef(null);
  const typesDialog = useRef(null);
  const moreMenu = useRef(null);
  const formRef = useRef(null);
  const tabsRef = useRef(null);
  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(showLegalFields ? [{ id: 'legal', label: 'Legal & signing' }] : []),
    ...(profile.taxPanel ? [{ id: 'tax', label: 'Tax & payouts' }] : []),
    ...(!profile.createMode ? [{ id: 'activity', label: 'Activity' }] : []),
  ];
  const activeSection = tabs.some((tab) => tab.id === section) ? section : 'overview';
  const tabId = (id) => `${formId}-tab-${id}`;
  const panelId = (id) => `${formId}-panel-${id}`;
  const goTo = (id) => {
    setSection(id);
    requestAnimationFrame(() => document.getElementById(tabId(id))?.focus());
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const close = (event) => {
      if (moreMenu.current && !moreMenu.current.contains(event.target)) moreMenu.current.open = false;
      if (event.key === 'Escape' && moreMenu.current) moreMenu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const input = (key, label, { type = 'text', placeholder = '', full = false, required = false } = {}) => (
    <div className={`${styles.field} ${full ? styles.full : ''}`} key={key}>
      <label htmlFor={`${formId}-${key}`}>{label}</label>
      <input id={`${formId}-${key}`} name={key} value={values[key] || ''} type={type}
        required={required} placeholder={placeholder} onChange={(e) => setField(key, e.target.value)} />
    </div>
  );
  const submit = (event) => {
    // Hidden panels stay mounted to preserve edits. Reveal invalid fields before
    // asking the browser to focus them; native hidden-field validation cannot.
    const invalid = Array.from(event.currentTarget.elements).find((el) => el.willValidate && !el.validity.valid);
    if (invalid) {
      event.preventDefault();
      setSection(invalid.closest('[data-profile-section]')?.dataset.profileSection || 'overview');
      requestAnimationFrame(() => invalid.reportValidity());
      return;
    }
    onSubmit(event);
  };
  const openPhoto = () => {
    setPhotoDraft(values.photo_url);
    setPhotoError('');
    photoDialog.current.showModal();
  };
  const applyPhoto = () => {
    const next = photoDraft.trim();
    if (next && next !== values.photo_url) {
      try {
        const parsed = new URL(next);
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
      } catch {
        setPhotoError('Enter a valid http:// or https:// image URL.');
        return;
      }
    }
    setField('photo_url', next);
    photoDialog.current.close();
  };
  const openTypes = () => { setTypeDraft([...values.contact_type]); setTypeError(''); typesDialog.current.showModal(); };
  const applyTypes = () => {
    if (!CONTACT_TYPE_OPTIONS.some((opt) => isContactTypeSelected(typeDraft, opt.value))) {
      setTypeError('Select at least one relationship type.');
      return;
    }
    setField('contact_type', typeDraft);
    typesDialog.current.close();
  };
  const onTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab.id === activeSection);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    goTo(tabs[index].id);
  };

  const relationship = (
    <section className={styles.card}>
      <div className={styles.cardBody}>
        <div className={styles.row}>
          <label className={styles.fieldLabel} htmlFor={`${formId}-status`}>Status</label>
          <select id={`${formId}-status`} className={styles.statusSelect} required
            value={CONTACT_STATUS_OPTIONS.some((opt) => opt.value === values.status) ? values.status : ''}
            onChange={(e) => setField('status', e.target.value)}>
            {!CONTACT_STATUS_OPTIONS.some((opt) => opt.value === values.status) && <option value="" disabled>Select status</option>}
            {CONTACT_STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        {!CONTACT_STATUS_OPTIONS.some((opt) => opt.value === values.status) && <p className={styles.hint}>Choose Active, Do Not Book, or Archived before saving this contact.</p>}
        {values.status === 'do_not_book' && <p className={styles.danger}>Do Not Book is flagged throughout the directory.</p>}
        {values.status === 'archived' && <p className={styles.warningText}>Archived contacts stay on file but are hidden from pickers and cannot be sent new contracts.</p>}
        <p className={styles.relationshipLabel}>Relationship types{profile.createMode ? ' · required' : ''}</p>
        <div className={styles.field}>
          <label htmlFor={`${formId}-profile-kind`}>Profile type</label>
          <select id={`${formId}-profile-kind`} value={values.profile_kind} onChange={(event) => {
            setField('profile_kind', event.target.value);
            if (event.target.value === 'organization' && !isContactTypeSelected(values.contact_type, 'organization')) {
              setField('contact_type', [...values.contact_type, 'organization']);
            }
          }}>
            <option value="person">Person</option><option value="organization">Organization</option>
          </select>
        </div>
        <div className={styles.tags}>{CONTACT_TYPE_OPTIONS.filter((opt) => isContactTypeSelected(values.contact_type, opt.value)).map((opt) => <span key={opt.value} className={styles.tag}>{opt.label}</span>)}</div>
        {profile.createMode && values.contact_type.length === 0 && <p className={styles.hint}>Choose at least one type.</p>}
        <button type="button" className={styles.textButton} onClick={openTypes}>{profile.createMode && values.contact_type.length === 0 ? 'Select relationship types' : 'Edit relationship types'}</button>
      </div>
    </section>
  );

  return (
    <div className={styles.profile}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href={contactDirectoryHref(initialCategory, profile.archivedView || contact.status === 'archived')} onClick={(event) => {
          if (dirty && !window.confirm('Discard unsaved contact changes and return to Contacts?')) event.preventDefault();
        }}>← {profile.archivedView || contact.status === 'archived' ? 'Archived Contacts' : 'Contacts'}</Link><span aria-hidden="true">/</span><span>{profile.createMode ? 'New contact' : contact.display_name}</span>
      </nav>
      <header className={styles.header}>
        <div className={styles.identity}>
          <button type="button" className={styles.photo} onClick={openPhoto} disabled={saving} aria-label="Change contact photo" title="Change contact photo">
            <ProfilePhoto key={values.photo_url} url={values.photo_url} name={values.display_name} /><span className={styles.photoEdit} aria-hidden="true">+</span>
          </button>
          <div className={styles.identityText}>
            <span className={styles.hint}>{organization ? 'Organization profile' : 'Person profile'}</span>
            <h1>{profile.createMode ? (values.display_name.trim() || 'New contact') : contact.display_name}</h1>
            <p>{profile.createMode
              ? ([values.company, !organization && values.primary_contact_name].filter(Boolean).join(' · ') || 'Add a person or organization')
              : [contact.company, !organization && contact.primary_contact_name].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.saveState} role="status">{saving ? 'Saving…' : profile.createMode ? (dirty ? 'Unsaved new contact' : 'Ready for details') : dirty ? 'Unsaved changes' : success ? 'Saved' : 'No unsaved changes'}</span>
          {dirty && <button type="button" className={styles.button} onClick={onDiscard} disabled={saving}>{profile.createMode ? 'Clear' : 'Discard'}</button>}
          <button type="submit" form={formId} className={`${styles.button} ${styles.primaryButton}`} disabled={saving || (!profile.createMode && !dirty)}>{saving ? 'Saving…' : profile.createMode ? 'Create contact' : 'Save changes'}</button>
          {profile.canArchive && (
            <details className={styles.more} ref={moreMenu}>
              <summary aria-label="More contact actions" title="More contact actions">⋯</summary>
              <div className={styles.moreContent}>
                <button type="button" className={styles.button} disabled={saving || dirty}
                  onClick={() => { moreMenu.current.open = false; onArchive(); }}>
                  {contact.status === 'archived' ? 'Restore contact' : 'Archive contact'}
                </button>
                {dirty && <p className={styles.hint}>Save or discard your changes first.</p>}
              </div>
            </details>
          )}
        </div>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="Contact sections" ref={tabsRef} onKeyDown={onTabKeyDown}>
        {tabs.map((tab) => <button key={tab.id} type="button" id={tabId(tab.id)} role="tab"
          aria-selected={activeSection === tab.id} aria-controls={panelId(tab.id)}
          tabIndex={activeSection === tab.id ? 0 : -1} onClick={() => setSection(tab.id)}>
          {tab.label}{tab.id === 'tax' && profile.w9Missing && <span className={styles.warningDot} aria-label="W-9 missing" />}
        </button>)}
      </div>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {success && !dirty && <p role="status" className={styles.success}>{success}</p>}
      {!profile.createMode && contact.status === 'archived' && <div className={`${styles.banner} ${styles.archivedBanner}`}>
        <strong>Archived contact.</strong> Details, linked records, and history are preserved. This contact is hidden from the main directory.
        {profile.canArchive && <button type="button" className={styles.textButton} disabled={saving || dirty} onClick={onArchive}>Restore contact</button>}
      </div>}

      {activeSection === 'overview' && !profile.createMode && contactProfileKind(contact) === 'organization' &&
        <OrganizationMainContact contactId={contact.id} legacyName={contact.primary_contact_name}
          isAdmin={profile.isAdmin} disabled={dirty || saving || contact.status === 'archived'} />}
      {activeSection === 'overview' && organization && profile.createMode &&
        <p className={styles.hint}>Create the organization first, then select an existing person or create its main point of contact here.</p>}
      <form id={formId} ref={formRef} onSubmit={submit} noValidate>
        <fieldset disabled={saving} className={styles.editable}>
          <div id={panelId('overview')} role="tabpanel" aria-labelledby={tabId('overview')} hidden={activeSection !== 'overview'} data-profile-section="overview">
            <div className={styles.layout}>
              <div className={styles.stack}>
                <section className={styles.card}>
                  <div className={styles.cardHeading}><h2>{organization ? 'Organization details' : 'Contact details'}</h2></div>
                  <div className={styles.cardBody}>
                    <div className={styles.fields}>
                      {input('display_name', organization ? 'Organization name' : 'Display name', { required: true })}
                      {input('company', 'Company / organization')}
                      {!organization && input('primary_contact_name', 'Primary contact')}
                      {input('email', 'Email address', { type: 'email' })}
                      {input('phone', 'Phone number', { type: 'tel' })}
                      {input('instagram_handle', 'Instagram', { placeholder: '@username' })}
                      {input('website', 'Website', { placeholder: 'https://', full: true })}
                    </div>
                    <div className={styles.additionalHeading}><div><h3>Additional contacts</h3><p>Other people associated with this contact.</p></div>
                      <button type="button" className={styles.textButton} onClick={() => setField('additional_contacts', [...values.additional_contacts, { name: '', role: '', email: '', phone: '' }])}>+ Add person</button>
                    </div>
                    {values.additional_contacts.map((person, index) => <div key={index} className={styles.person}>
                      <div className={styles.row}><h3>Additional contact {index + 1}</h3><button type="button" className={`${styles.textButton} ${styles.danger}`} onClick={() => setField('additional_contacts', values.additional_contacts.filter((_, i) => i !== index))}>Remove<span className={styles.srOnly}> contact {index + 1}</span></button></div>
                      <div className={styles.fields}>{['name', 'role', 'email', 'phone'].map((key) => <div className={styles.field} key={key}>
                        <label htmlFor={`${formId}-person-${index}-${key}`}>{key[0].toUpperCase() + key.slice(1)}</label>
                        <input id={`${formId}-person-${index}-${key}`} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                          value={person[key] || ''} onChange={(e) => setField('additional_contacts', values.additional_contacts.map((p, i) => i === index ? { ...p, [key]: e.target.value } : p))} />
                      </div>)}</div>
                    </div>)}
                  </div>
                </section>
                <section className={styles.card}>
                  <div className={styles.cardHeading}><h2>Internal notes</h2><span>Team only</span></div>
                  <div className={styles.cardBody}><div className={styles.field}>
                    <label htmlFor={`${formId}-notes`} className={styles.srOnly}>Internal notes</label>
                    <textarea id={`${formId}-notes`} value={values.internal_notes} rows={3} placeholder="Add booking preferences, context, or follow-up notes…" onChange={(e) => setField('internal_notes', e.target.value)} />
                  </div><p className={styles.hint}>Not shared with this contact.</p></div>
                </section>
              </div>
              <aside className={styles.sidebar} aria-label="Contact status and setup">
                {relationship}
                {(profile.isOrganizer || profile.showTaxStatus) && (
                  <section className={`${styles.card} ${styles.readiness}`}>
                    <div className={styles.cardHeading}><h2>Setup &amp; readiness</h2></div>
                    <div className={styles.cardBody}>
                      {profile.isOrganizer && <div className={styles.readinessItem}>
                        <div className={styles.row}><h3>Contracts</h3><span className={contact.status === 'archived' || profile.organizerGaps.length ? styles.warningText : styles.ready}>{contact.status === 'archived' ? 'Archived' : profile.organizerGaps.length ? 'Incomplete' : '✓ Ready'}</span></div>
                        <p className={styles.hint}>{contact.status === 'archived' ? 'Restore this contact before sending new agreements.' : profile.organizerGaps.length ? `Still needs ${profile.organizerGaps.join(', ')}.` : 'Legal and signing details are on file.'}</p>
                        <button type="button" className={styles.textButton} onClick={() => goTo('legal')}>{profile.organizerGaps.length ? 'Complete signing details' : 'View signing details'}</button>
                      </div>}
                      {profile.showTaxStatus && <div className={profile.w9Missing ? styles.warningBox : styles.readinessItem}>
                        <h3 className={profile.w9Missing ? styles.warningText : styles.ready}>{profile.w9Status === 'pending' ? 'W-9 awaiting review' : profile.w9Missing ? 'W-9 approval required' : 'W-9 approved'}</h3>
                        <p className={styles.hint}>{profile.w9Missing ? 'Approval is required before booking or requesting pay.' : 'Signed W-9 approved and securely retained.'}</p>
                        <button type="button" className={styles.textButton} onClick={() => goTo('tax')}>View W-9 status</button>
                      </div>}
                    </div>
                  </section>
                )}
                {profile.createMode && !profile.isOrganizer && (
                  <section className={styles.card}>
                    <div className={styles.cardHeading}><h2>Before you create</h2></div>
                    <div className={styles.cardBody}>
                      <p className={styles.hint}>Choose every applicable relationship type and add the contact details your team will search by.</p>
                      <p className={styles.hint}>Legal and signing details appear automatically for relationship types that can sign agreements.</p>
                    </div>
                  </section>
                )}
                {profile.portalPanel && <section className={styles.card}>
                  <div className={styles.cardHeading}><h2>Portal access</h2><span>Admin</span></div>
                  <div className={styles.cardBody}>
                    <p className={styles.hint}>{profile.portalStatus}</p>
                    <details className={styles.portalDetails}><summary>Manage portal access</summary>{profile.portalPanel}</details>
                    {dirty && <p className={styles.hint}>Invitations use the saved email. Save contact changes first.</p>}
                  </div>
                </section>}
                {!profile.createMode && <div className={styles.metadata}><p><span>Added</span><time>{profile.createdLabel}</time></p><p><span>Last updated</span><time>{profile.updatedLabel}</time></p><button type="button" className={styles.textButton} onClick={() => goTo('activity')}>View activity &amp; edit history</button></div>}
              </aside>
            </div>
          </div>
          {showLegalFields && <div id={panelId('legal')} role="tabpanel" aria-labelledby={tabId('legal')} hidden={activeSection !== 'legal'} data-profile-section="legal">
            <div className={styles.legalLayout}><div className={styles.stack}>
              {profile.legalSummary || (profile.createMode && <div className={styles.banner}><strong>Complete before contracting.</strong> These details determine who signs and where legal notices are sent. You can create the contact before every field is complete.</div>)}
              <section className={styles.card}><div className={styles.cardHeading}><h2>Legal entity</h2></div><div className={styles.cardBody}><div className={styles.fields}>
                {input('legal_name', 'Legal name', { placeholder: 'Exact name on the agreement' })}
                <div className={styles.field}><label htmlFor={`${formId}-entity-type`}>Entity type</label><select id={`${formId}-entity-type`} value={values.entity_type} onChange={(e) => setField('entity_type', e.target.value)}><option value="">Not specified</option>{ENTITY_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                {input('address_line1', 'Street address', { full: true })}
                {input('address_line2', 'Suite / unit (optional)', { full: true })}
                {input('address_city', 'City')}{input('address_state', 'State / province', { placeholder: 'TX' })}
                {input('address_postal_code', 'ZIP / postal code')}{input('address_country', 'Country', { placeholder: 'USA' })}
              </div></div></section>
              <section className={styles.card}><div className={styles.cardHeading}><h2>Default signer</h2></div><div className={styles.cardBody}><div className={styles.fields}>
                {input('default_signer_name', 'Signer name', { placeholder: 'Who signs on their behalf' })}
                {input('default_signer_email', 'Signer email', { type: 'email', placeholder: 'Where signature requests go' })}
              </div><p className={styles.hint}>When signer email is blank, the contact email is used.</p></div></section>
            </div><aside className={styles.card}><div className={styles.cardHeading}><h2>Contract identity</h2></div><div className={styles.cardBody}><h3>{values.legal_name || values.display_name || 'New contact'}</h3>{values.legal_name && values.display_name && values.legal_name !== values.display_name && <p className={styles.hint}>Doing business as {values.display_name}</p>}<p className={styles.guidance}>Contact details identify who you work with. Legal details identify who signs the agreement.</p><p className={styles.hint}>{profile.createMode ? 'You can finish these details later from the saved contact.' : 'Start a contract from the event this organizer is attached to.'}</p></div></aside></div>
          </div>}
        </fieldset>
      </form>
      {/* Independent forms must not be nested in the contact form. They keep
          their existing server-authoritative save/upload/invite behavior. */}
      {profile.taxPanel && <div id={panelId('tax')} role="tabpanel" aria-labelledby={tabId('tax')} hidden={activeSection !== 'tax'} className={styles.separatePanels}>{profile.taxPanel}</div>}
      {!profile.createMode && <div id={panelId('activity')} role="tabpanel" aria-labelledby={tabId('activity')} hidden={activeSection !== 'activity'}>{profile.activityPanel}</div>}

      <dialog ref={photoDialog} className={styles.dialog} aria-labelledby={`${formId}-photo-title`}>
        <div className={styles.dialogHeading}><h2 id={`${formId}-photo-title`}>Contact photo</h2><button type="button" className={styles.closeButton} onClick={() => photoDialog.current.close()} aria-label="Close photo editor">×</button></div>
        <div className={styles.dialogBody}><div className={styles.photoPreview}><ProfilePhoto key={photoDraft} url={photoDraft} name={values.display_name} /></div>
          <div className={styles.field}><label htmlFor={`${formId}-photo-url`}>Image URL</label><input id={`${formId}-photo-url`} value={photoDraft} onChange={(e) => { setPhotoDraft(e.target.value); setPhotoError(''); }} placeholder="https://example.com/photo.jpg" /></div>
          <p className={styles.hint}>Use a link to the contact’s photo. It appears as a small square in the directory and profile.</p>
          {photoError && <p role="alert" className={styles.danger}>{photoError}</p>}
          <button type="button" className={styles.textButton} onClick={() => setPhotoDraft('')}>Remove photo</button>
        </div><div className={styles.dialogFooter}><button type="button" className={styles.button} onClick={() => photoDialog.current.close()}>Cancel</button><button type="button" className={`${styles.button} ${styles.primaryButton}`} onClick={applyPhoto}>Apply photo</button></div>
      </dialog>
      <dialog ref={typesDialog} className={styles.dialog} aria-labelledby={`${formId}-types-title`}>
        <div className={styles.dialogHeading}><h2 id={`${formId}-types-title`}>Relationship types</h2><button type="button" className={styles.closeButton} onClick={() => typesDialog.current.close()} aria-label="Close relationship editor">×</button></div>
        <div className={styles.dialogBody}><p className={styles.hint}>Select every type that applies.</p><div className={styles.checks}>{CONTACT_TYPE_OPTIONS.map((opt) => <label key={opt.value}><input type="checkbox" checked={isContactTypeSelected(typeDraft, opt.value)} onChange={() => { setTypeDraft((prev) => toggleContactType(prev, opt.value)); setTypeError(''); }} />{opt.label}</label>)}</div>{typeError && <p className={styles.danger} role="alert">{typeError}</p>}</div>
        <div className={styles.dialogFooter}><button type="button" className={styles.button} onClick={() => typesDialog.current.close()}>Cancel</button><button type="button" className={`${styles.button} ${styles.primaryButton}`} onClick={applyTypes}>Apply types</button></div>
      </dialog>
    </div>
  );
}
