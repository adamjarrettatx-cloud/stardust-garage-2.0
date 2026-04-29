import { createClient } from '@/lib/supabase/server';
import SplashClient from './components/SplashClient';

export const revalidate = 0;

export default async function SplashPage() {
  const supabase = await createClient();
  const { data: logoSetting } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'splash_logo_image')
    .single();

  const logoUrl = logoSetting?.value || '';

  return <SplashClient logoUrl={logoUrl} />;
}
