import { redirect } from 'next/navigation';

// Login is unified at /login (role is looked up server-side from
// team_members.role after sign-in and used to redirect appropriately).
// This route stays alive as a redirect so old bookmarks/links still work.
export default function TeamLoginRedirect() {
  redirect('/login');
}
