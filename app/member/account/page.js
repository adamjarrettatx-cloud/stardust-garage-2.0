import { redirect } from 'next/navigation';

// Preserve member bookmarks while using the shared account settings surface.
export default function AccountSettingsPage() {
  redirect('/account/security');
}
