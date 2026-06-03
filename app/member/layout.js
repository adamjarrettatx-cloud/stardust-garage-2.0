import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';

export default async function MemberLayout({ children }) {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return <>{children}</>;
}
