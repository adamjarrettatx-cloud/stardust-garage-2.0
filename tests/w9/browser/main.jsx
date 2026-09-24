import React from 'react';
import {createRoot} from 'react-dom/client';
import ArtistW9 from '@/components/w9/ArtistW9';
import TaxProfileSection from '@/app/bananas/contacts/[id]/TaxProfileSection';
import './style.css';
const reviewer=new URLSearchParams(location.search).has('reviewer');
const history=reviewer?[]:(await (await fetch('/api/portal/w9')).json()).submissions;
createRoot(document.getElementById('root')).render(<main><header>STARDUST GARAGE<span>{reviewer?'CONTACTS / TEST ARTIST':'YOUR PROFILE'}</span></header><h1>{reviewer?'Test Artist':'Artist profile'}</h1><p>Local implementation test. Simulated data only.</p>{reviewer?<TaxProfileSection contactId="test-contact" displayName="Test Artist"/>:<ArtistW9 initialSubmissions={history}/>}</main>);
