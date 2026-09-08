import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import { resolveMemberPhotoUrls } from '@/lib/member-photo';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import MembersListClient from './MembersListClient';

export const revalidate = 0;

// Fetch-only server page. All rendering, filtering and the Active /
// Inactive-Pending tab state live in MembersListClient, because tab selection
// needs client state.
export default async function AdminMembersPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  const { data: members } = await supabase
    .from('member_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  // Resolve display photos server-side: for rows with profile_photo_path we
  // mint a short-lived signed URL from the private bucket; legacy rows fall
  // back to their photo_url. Attaching display_photo_url onto each row keeps
  // MemberAvatar a dumb client component that just renders whatever URL it's
  // handed — no admin client, no async work in a client component.
  const admin = createAdminClient();
  const photoMap = await resolveMemberPhotoUrls(admin, members || []);
  const membersWithPhotos = (members || []).map((m) => ({
    ...m,
    display_photo_url: photoMap.get(m.id) || null,
  }));

  return (
    <>
      <AuthenticatedPageHeader
        title="Members"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      <MembersListClient members={membersWithPhotos} />
    </>
  );
}
