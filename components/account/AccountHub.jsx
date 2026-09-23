'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import ProfileAvatar from '@/components/profile-photo/ProfileAvatar';
import ProfilePhotoSection from '@/app/account/profile/ProfilePhotoSection';
import AccountNavigation from '@/app/account/AccountNavigation';
import SignOutButton from '@/app/account/SignOutButton';

export default function AccountHub({ profile, children }) {
  const photoDialog = useRef(null);
  const [theme, setTheme] = useState('dark');
  return <main className="account-hub" data-theme={theme}>
    <div className="account-hub-shell">
      <div className="account-hub-topline"><span>Your Stardust account</span><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'} appearance</button></div>
      <header className="account-hub-hero">
        <div className="account-hub-portrait">
          <ProfileAvatar src={profile.photoUrl} nameOrEmail={profile.name || profile.email} size={88} />
          <button type="button" className="account-hub-text-button" onClick={() => photoDialog.current?.showModal()}>Change photo</button>
        </div>
        <div className="account-hub-identity"><p className="account-hub-eyebrow">{profile.label}</p><h1>{profile.name || 'Your profile'}</h1><p>{profile.email}</p></div>
        <Link className="account-hub-button" href="/account/profile?edit=1">Edit profile</Link>
      </header>
      <div className="account-hub-layout">
        <aside><AccountNavigation workspaces={profile.workspaces} /><div className="account-hub-signout"><SignOutButton /></div></aside>
        <div className="account-hub-content">{children}</div>
      </div>
      <dialog ref={photoDialog} className="account-hub-dialog" aria-label="Profile photo">
        <div className="account-hub-panel-heading"><h2>Profile photo</h2><button type="button" className="account-hub-text-button" onClick={() => photoDialog.current?.close()}>Close</button></div>
        <ProfilePhotoSection key={profile.photoUrl || 'empty'} initialSignedUrl={profile.photoUrl} nameOrEmail={profile.name || profile.email} />
      </dialog>
    </div>
  </main>;
}
