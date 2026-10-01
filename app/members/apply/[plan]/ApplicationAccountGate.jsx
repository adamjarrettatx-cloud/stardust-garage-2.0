'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AccountGate from '@/app/components/AccountGate';
export default function ApplicationAccountGate({ planName, quiz = false }) {
  const router = useRouter();
  return <main className="max-w-[480px] mx-auto px-6 py-16">
    <Link href={quiz ? '/home' : '/members'} className="inline-block mb-8 underline">{quiz ? '← Back to Stardust Garage' : '← Back to memberships'}</Link>
    <h1 className="text-[28px] font-bold mb-6">{quiz ? 'Find your kind of Stardust.' : planName}</h1>
    <AccountGate headline={quiz ? 'Sign in to find your fit' : 'An account is required to apply'} subheadline={quiz ? 'Create your Stardust account or sign in. Your completed quiz results will be saved to your account, ready on your phone or computer.' : 'Create your Stardust account or sign in. Your selected membership will carry forward.'} onSuccess={() => router.refresh()} />
  </main>;
}
