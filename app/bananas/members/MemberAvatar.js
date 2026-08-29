import { memberInitials } from './member-display';

// Themed avatar shared by the members list and the member profile header.
// `size` is a Tailwind width/height pair so the profile page can render a
// larger version of the exact same circle.
export default function MemberAvatar({ member, size = 'w-11 h-11', textClass = 'text-[14px]' }) {
  const shared = `${size} flex-shrink-0 rounded-full border`;

  if (member.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.photo_url}
        alt=""
        className={`${shared} object-cover`}
        style={{ borderColor: 'var(--auth-card-border-strong)' }}
      />
    );
  }

  return (
    <div
      className={`${shared} ${textClass} flex items-center justify-center font-bold`}
      style={{
        background: 'var(--auth-card-bg-alt)',
        borderColor: 'var(--auth-card-border-strong)',
        color: 'var(--auth-muted)',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {memberInitials(member.full_name, member.email)}
    </div>
  );
}
