import { redirect } from 'next/navigation';

// Calendar is unified at /team/calendar (same route serves admins and team
// members, gated server-side by team_members.role). Kept alive as a redirect
// so old bookmarks/links still work.
export default function BananasCalendarRedirect() {
  redirect('/team/calendar');
}
