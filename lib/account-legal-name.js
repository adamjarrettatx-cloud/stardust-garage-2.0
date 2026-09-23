import { validateLegalName } from './legal-name.js';

export async function accountLegalName(admin, userId) {
  const account = await admin.from('free_accounts').select('full_name,phone').eq('user_id', userId).maybeSingle();
  const member = await admin.from('member_profiles').select('full_name').eq('user_id', userId).maybeSingle();
  if (account.error || member.error) throw new Error('Profile lookup unavailable.');
  const fullName = account.data?.full_name || member.data?.full_name || '';
  return { fullName, phone: account.data?.phone || '', complete: validateLegalName(fullName).valid };
}
