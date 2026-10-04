import ProfileTickets from '@/components/account/ProfileTickets';
import ArtistW9Profile from '@/components/w9/ArtistW9Profile';
import MembershipQuizResults from '@/components/account/MembershipQuizResults';
import ProfileDoorPass from '@/components/account/ProfileDoorPass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function AccountProfilePage() {
  return <><ProfileDoorPass /><ArtistW9Profile /><ProfileTickets /><MembershipQuizResults /></>;
}
