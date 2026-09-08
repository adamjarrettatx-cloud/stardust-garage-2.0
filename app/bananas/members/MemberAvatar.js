import { memberInitials } from './member-display';

// Themed avatar shared by the members list and the member profile header.
// `size` is a Tailwind width/height pair so the profile page can render a
// larger version of the exact same circle.
//
// Photo URL preference:
//   1. display_photo_url — pre-resolved by the server page (signed URL from
//      the private profile-photos bucket when profile_photo_path is set;
//      legacy photo_url otherwise). Set by lib/member-photo.js.
//   2. photo_url — raw fallback for callers that haven't been retrofitted
//      to pass display_photo_url yet.
export default function MemberAvatar({ member, size = 'w-11 h-11', textClass = 'text-[14px]' }) {
  const shared = `${size} flex-shrink-0 rounded-full border`;
  const src = member.display_photo_url || member.photo_url;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
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
