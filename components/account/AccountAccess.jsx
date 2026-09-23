import Link from 'next/link';

export default function AccountAccess({ profile, showWorkspaces = false }) {
  return <>
    <section className="account-hub-panel" aria-label="Account and access">
      <div className="account-hub-panel-heading"><h3>Account &amp; access</h3></div>
      <dl className="account-hub-details">
        {profile.access.map((item) => <div className="account-hub-row" key={item.label}><dt>{item.label}</dt><dd>{item.value}<small>{item.detail}</small></dd></div>)}
      </dl>
    </section>
    {showWorkspaces && profile.workspaces.length > 0 && <section className="account-hub-panel">
      <div className="account-hub-panel-heading"><h3>Your workspaces</h3></div>
      <div className="account-hub-work-links">{profile.workspaces.map((item) => <Link key={item.href} href={item.href}>{item.label} →</Link>)}</div>
    </section>}
  </>;
}
