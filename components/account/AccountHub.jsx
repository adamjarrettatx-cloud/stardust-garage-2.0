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

export default function AccountHub({ profile, children }) {
  const photoDialog = useRef(null);
  const settingsDialog = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
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
  return <main className="account-hub" data-theme={theme}>
    <div className="account-hub-shell">
      <div className="account-hub-topline"><span>Your Stardust account</span><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'} appearance</button></div>
      <header className="account-hub-hero">
        <div className="account-hub-portrait">
          <ProfileAvatar src={profile.photoUrl} nameOrEmail={profile.name || profile.email} size={88} />
          <button type="button" className="account-hub-text-button" onClick={() => photoDialog.current?.showModal()}>Change photo</button>
        </div>
        <div className="account-hub-identity"><p className="account-hub-eyebrow">{profile.label}</p><h1>{profile.name || 'Your profile'}</h1><p>{profile.email}</p></div>
        <button type="button" className="account-hub-button" onClick={() => setSettingsOpen(true)}>Edit Profile</button>
      </header>
      <div className="account-hub-layout">
        <div className="account-hub-content">{children}</div>
        <AccountNavigation workspaces={profile.workspaces} />
      </div>
      <dialog ref={photoDialog} className="account-hub-dialog" aria-label="Profile photo">
        <div className="account-hub-panel-heading"><h2>Profile photo</h2><button type="button" className="account-hub-text-button" onClick={() => photoDialog.current?.close()}>Close</button></div>
        <ProfilePhotoSection key={profile.photoUrl || 'empty'} initialSignedUrl={profile.photoUrl} nameOrEmail={profile.name || profile.email} />
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
    </div>
  </main>;
}
