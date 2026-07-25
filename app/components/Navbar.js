import { createClient } from '@/lib/supabase/server';
import NavLinks from './NavLinks';
import NavBrand from './NavBrand';

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
      <nav className="flex items-center justify-between w-full max-w-[1100px] gap-4">
        <NavBrand logoUrl={logoUrl} />
        <div className="flex items-center gap-3 md:gap-5">
          <NavLinks />
        </div>
      </nav>
    </div>
  );
}
