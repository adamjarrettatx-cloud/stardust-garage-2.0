import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import { resolveMemberPhotoUrls } from '@/lib/member-photo';
import ApplicationsList from './ApplicationsList';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function ApplicationsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: applications } = await supabase
    .from('membership_applications')
    .select('*')
    .order('created_at', { ascending: false });

  // Same photo-resolution pattern as the members list — signed URL from the
  // private profile-photos bucket when profile_photo_path is set (new since
  // PR B.3), legacy public photo_url otherwise. resolveMemberPhotoUrls works
  // for either table because it only reads those two columns off the row.
  const admin = createAdminClient();
  const photoMap = await resolveMemberPhotoUrls(admin, applications || []);
  const appsWithPhotos = (applications || []).map((a) => ({
    ...a,
    display_photo_url: photoMap.get(a.id) || null,
  }));

  return (
    <>
      <AuthenticatedPageHeader
        title="Membership Applications"
        description="Applications submitted through the Members page."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      <ApplicationsList applications={appsWithPhotos} />
    </>
  );
}
