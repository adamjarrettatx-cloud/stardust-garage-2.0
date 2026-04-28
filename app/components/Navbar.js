import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import NavLinks from './NavLinks';
import Wordmark from './Wordmark';

export default async function Navbar() {
  const supabase = await createClient();
  const { data: logoSetting } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'logo_url')
    .single();

  const logoUrl = logoSetting?.value || '';

  return (
    <div className="flex justify-center pt-8 px-6">
      <nav className="flex items-center justify-between w-full max-w-[1100px]">
        <Link href="/" className="flex items-center" aria-label="Stardust Garage home">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Stardust Garage"
              className="h-10 w-auto object-contain"
            />
          ) : (
            <Wordmark size="sm" />
          )}
        </Link>
        <NavLinks />
      </nav>
    </div>
  );
}
