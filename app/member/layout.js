import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';

// This layout wraps every page under /member. The middleware already
// redirects unauthenticated users to /login, but we double-check here
// so the auth state is available to all child server components.
export default async function MemberLayout({ children }) {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return <>{children}</>;
}
