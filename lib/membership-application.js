import { validateLegalName } from './legal-name.js';
import { PLAN_SLUGS } from './membership-quiz.js';
export function validateMembershipApplication(body, user, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid application.');
  if (!Object.values(PLAN_SLUGS).includes(body.plan)) throw new Error('Choose a valid membership.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submission_key || '')) throw new Error('Please reload the application.');
  const name = validateLegalName(body.full_name);
  if (!name.valid) throw new Error(name.error);
  const data = { plan: body.plan, full_name: body.full_name.trim(), email: user.email, applicant_user_id: user.id, submission_key: body.submission_key };
  if (!user.email) throw new Error('An account email is required.');
  for (const field of ['phone', 'social_handle', 'why_stardust', 'how_did_you_hear', 'how_contribute', 'what_experiences', 'preferred_name', 'website']) {
    const value = ['preferred_name', 'website'].includes(field) && body[field] == null ? '' : body[field];
    if (typeof value !== 'string' || value.length > (['phone', 'social_handle', 'preferred_name'].includes(field) ? 200 : 4000)) throw new Error('Please check your application details.');
    data[field] = value.trim();
  }
  for (const field of ['phone', 'social_handle', 'why_stardust', 'how_did_you_hear', 'how_contribute', 'what_experiences']) {
    if (!data[field]) throw new Error('Please complete all required fields.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.birthday || '')) throw new Error('Enter a valid date of birth.');
  const birth = new Date(`${body.birthday}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== body.birthday) throw new Error('Enter a valid date of birth.');
  const today = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).filter(p => ['year', 'month', 'day'].includes(p.type)).map(p => [p.type, Number(p.value)]));
  let age = today.year - birth.getUTCFullYear();
  if (today.month < birth.getUTCMonth() + 1 || (today.month === birth.getUTCMonth() + 1 && today.day < birth.getUTCDate())) age--;
  if (age < 21 || age > 120) throw new Error('You must be 21 or older to apply.');
  data.birthday = body.birthday;
  for (const field of ['agreed_ethos', 'agreed_renewal', 'agreed_house_rules']) {
    if (body[field] !== true) throw new Error('Please accept all three agreements.');
    data[field] = true;
  }
  const photoPattern = new RegExp(`^member-app/${user.id}/[0-9a-f-]{36}/photo\\.(jpg|jpeg|png|webp|heic|heif)$`, 'i');
  if (typeof body.profile_photo_path !== 'string' || !photoPattern.test(body.profile_photo_path)) throw new Error('Upload a profile photo from this account.');
  data.profile_photo_path = body.profile_photo_path;
  data.profile_photo_uploaded_at = now.toISOString();
  data.photo_url = null;
  data.status = 'new';
  return data;
}
