import { redirect } from 'next/navigation';

// Progress is unified at /team/progress (same route serves admins and team
// members, gated server-side by team_members.role). Kept alive as a redirect
// so old bookmarks/links still work.
export default function BananasProgressRedirect() {
  redirect('/team/progress');
}
