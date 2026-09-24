import Link from 'next/link';

// Only operational destinations remain on the main profile. Account settings
// belong inside Edit Profile, not in a second profile menu or a tab strip.
export default function AccountNavigation({ workspaces = [] }) {
  if (!workspaces.length) return null;
  return <section className="account-workspaces" aria-labelledby="account-workspaces-title">
    <h2 id="account-workspaces-title">Workspace</h2>
    <nav aria-label="Your workspaces">
      {workspaces.map((item) => <Link href={item.href} key={item.href}>{item.label}<span aria-hidden="true">→</span></Link>)}
    </nav>
  </section>;
}
