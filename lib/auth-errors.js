// Recognise Supabase Auth "this email already has an account" errors.
//
// Supabase has reported this several ways over time:
//   code 'user_already_exists' / message 'User already registered'
//   code 'email_exists' (HTTP 422) / message 'A user with this email address
//   has already been registered'
// Missing the newer form turned duplicate-email signups into a generic
// "Could not create account." 500 instead of the sign-in hand-off.
export function isExistingUserError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  if (code === 'user_already_exists' || code === 'email_exists') return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('already registered') || msg.includes('already been registered');
}
