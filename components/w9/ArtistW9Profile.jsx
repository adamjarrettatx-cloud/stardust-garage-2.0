import { getCurrentPartner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isContractorContact } from '@/lib/contact-helpers';
import { w9Enabled,loadW9History } from '@/lib/w9/server';
import ArtistW9 from './ArtistW9';
export default async function ArtistW9Profile(){
  const {partner,isActivePartner}=await getCurrentPartner();
  if(!isActivePartner||!isContractorContact(partner?.contact_type))return null;
  if(!partner.activated_at||!partner.full_name?.trim()||!partner.photo_url)return <p>Complete your artist profile before filling out your W-9.</p>;
  try{
    const admin=createAdminClient();
    if(!await w9Enabled(admin))return null;
    const submissions=await loadW9History(admin,partner.contact_id);
    return <ArtistW9 initialSubmissions={submissions}/>;
  }catch{return <p role="alert">Your W-9 status could not be loaded. Please refresh before requesting a booking.</p>}
}
