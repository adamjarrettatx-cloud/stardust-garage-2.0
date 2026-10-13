'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ProfileAvatar from '@/components/profile-photo/ProfileAvatar';
import ProfilePhotoSection from '@/app/account/profile/ProfilePhotoSection';
import AccountNavigation from '@/app/account/AccountNavigation';
import SignOutButton from '@/app/account/SignOutButton';
import PersonalDetails from './PersonalDetails';
import AccountAccess from './AccountAccess';
import PasswordSettings from './PasswordSettings';
import ProfileClient from '@/app/portal/(loggedin)/profile/ProfileClient';
import PhoneVerificationDialog from './PhoneVerificationDialog';
import { formatPhone } from '@/lib/phone';

export default function AccountHub({ profile, children }) {
  const photoDialog = useRef(null);
  const settingsDialog = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const requestedSection = params.get('edit');
  useEffect(() => {
    if (['1', 'membership', 'security'].includes(requestedSection)) setSettingsOpen(true);
  }, [requestedSection]);
  useEffect(() => {
    if (settingsOpen) settingsDialog.current?.showModal();
  }, [settingsOpen]);
  function closeSettings() {
    setSettingsOpen(false);
    if (requestedSection) router.replace('/account/profile', { scroll: false });
  }
  return <main className="account-hub">
    <div className="account-hub-shell">
      <div className="account-hub-topline"><h1>Profile</h1>
        <button type="button" className="account-hub-gear" aria-label="Profile settings" title="Profile settings" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
      </div>
      <header className="account-hub-hero">
        <button type="button" className="account-hub-portrait" aria-label={profile.photoUrl ? 'Change profile photo' : 'Add profile photo'} onClick={() => photoDialog.current?.showModal()}>
          <ProfileAvatar src={profile.photoUrl} nameOrEmail={profile.name || profile.email} size={88} radius={18} />
          <span className="account-hub-photo-badge" aria-hidden="true">{profile.photoUrl ? <CameraIcon /> : '+'}</span>
        </button>
        <div className="account-hub-identity">
          <p className="account-hub-name">{profile.name || 'Your profile'}</p>
          <p>{profile.email}</p>
          <div className="account-hub-phone">
            <span>{formatPhone(profile.phone) || 'Add phone number'}</span>
            {profile.phone && profile.phoneVerified
              ? <span className="account-hub-verified" role="img" aria-label="Phone verified" title="Phone verified"><CheckIcon /></span>
              : <button type="button" className="account-hub-verify-tag" aria-label={profile.phone ? 'Verify phone number' : 'Add and verify phone number'} onClick={() => setVerifying(true)}>not verified</button>}
          </div>
        </div>
      </header>
      <div className="account-hub-layout">
        <div className="account-hub-content">{children}</div>
        <AccountNavigation workspaces={profile.workspaces} />
      </div>
      <dialog ref={photoDialog} className="account-hub-dialog" aria-label="Profile photo">
        <div className="account-hub-panel-heading"><h2>Profile photo</h2><button type="button" className="account-hub-text-button" onClick={() => photoDialog.current?.close()}>Close</button></div>
        <ProfilePhotoSection key={profile.photoUrl || 'empty'} initialSignedUrl={profile.photoUrl} nameOrEmail={profile.name || profile.email} avatarRadius={14} />
      </dialog>
      {settingsOpen && <dialog ref={settingsDialog} className="account-hub-dialog account-settings-dialog" aria-labelledby="profile-settings-title" onClose={closeSettings}>
        <div className="account-hub-panel-heading"><h2 id="profile-settings-title">Edit Profile</h2><button type="button" className="account-hub-text-button" onClick={() => settingsDialog.current?.close()}>Close</button></div>
        <div className="account-settings-body">
          <PersonalDetails key={profile.email} profile={profile} initialEditing={!['membership', 'security'].includes(requestedSection)} />
          <details className="account-settings-section" open={requestedSection === 'membership'}>
            <summary>{profile.membershipAction ? 'Memberships & Access' : 'Account & Access'}</summary>
            <AccountAccess profile={profile} />
          </details>
          <details className="account-settings-section" open={requestedSection === 'security'}>
            <summary>Login &amp; Security</summary>
            <PasswordSettings />
            <div className="account-hub-padded"><SignOutButton /></div>
          </details>
          {profile.partnerActive && <details className="account-settings-section"><summary>Partner details</summary><ProfileClient profile={profile.partner} /></details>}
        </div>
      </dialog>}
      {verifying && <PhoneVerificationDialog profile={profile} onClose={() => setVerifying(false)} />}
    </div>
  </main>;
}

function GearIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6 1.7 1.7 0 0 0 9.97 3.04V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.07z" />
  </svg>;
}

function CameraIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z" />
  </svg>;
}

function CheckIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>;
}
