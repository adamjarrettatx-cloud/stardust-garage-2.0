import { redirect } from 'next/navigation';

// Keep receipts, wallet links, and old bookmarks pointed at the real wallet.
export default function AccountTicketsPage() {
  redirect('/account/profile#tickets');
}
