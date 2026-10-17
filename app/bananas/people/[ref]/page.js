import { notFound, redirect } from 'next/navigation';
import { adminPageGate, OWNER_EMAIL } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseProfileRef } from '@/lib/person-profile/identity';
import { loadPersonProfile } from '@/lib/person-profile/load';
import PersonProfileClient from './PersonProfileClient';

export const revalidate = 0;
export const metadata = { title: 'Person profile · Stardust Garage' };

// Unified admin profile for anyone in people search: Guest, Trial, Member or
// Applicant. Read-only history plus staff notes and tags. See
// lib/person-profile/load.js for every source and how visits are counted.
export default async function PersonProfilePage({ params }) {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { ref } = await params;
  const parsed = parseProfileRef(ref);
  if (!parsed) notFound();

  const admin = createAdminClient();
  const viewer = { id: user.id, email: user.email, isOwner: (user.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase() };
  const profile = await loadPersonProfile(admin, parsed, { viewer });
  if (!profile) notFound();

  return <PersonProfileClient profile={profile} />;
}
