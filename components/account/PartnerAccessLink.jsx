import Link from 'next/link';
import { getCurrentPartner } from '@/lib/auth-helpers';
import { portalName } from '@/lib/role-label';

export default async function PartnerAccessLink() {
  const { partner, isActivePartner } = await getCurrentPartner();
  if (!isActivePartner) return null;
  return (
    <Link
      href="/portal/profile"
      className="inline-flex items-center px-4 py-3 rounded-[12px] border text-[12px] font-semibold"
      style={{ borderColor: 'rgba(217,196,140,0.35)', color: '#d9c48c' }}
    >
      {portalName(partner.contact_type)} →
    </Link>
  );
}
